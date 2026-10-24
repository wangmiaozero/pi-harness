import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type {
  AiPreferences,
  InstructionDocument,
  McpInput,
  McpInventory,
  SettingsScope
} from '@shared/agent-settings/schema'
import { aiPreferencesSchema } from '@shared/agent-settings/schema'
import type { PiConfigService } from '../pi/config-service'
import type { FileAccessService } from '../files/file-access-service'
import { atomicWriteText } from '../services/storage'
import { ConfigConflictError, ConfigError, PathDeniedError } from '../services/errors'
import { redactSecretText } from '../services/logger'

const digest = (text: string) => createHash('sha256').update(text).digest('hex')
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
const referenceFields = (value: unknown) =>
  Object.fromEntries(
    Object.entries(object(value)).filter(
      ([, v]) => typeof v === 'string' && /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(v)
    )
  ) as Record<string, string>

function safeUrl(value: unknown): string {
  try {
    const url = new URL(String(value))
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return ''
  }
}

function safeArgs(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  let secretNext = false
  return value.map((v) => {
    const s = String(v)
    const secret = secretNext
    secretNext = /^--?(?:api[-_]?key|token|password|secret|authorization)$/i.test(s)
    return secret
      ? '••••••••'
      : redactSecretText(s).replace(/((?:api[-_]?key|token|password|secret)=).+/i, '$1••••••••')
  })
}

/** Pi owns the file formats. This service only edits their supported fields. */
export class AgentPreferencesService {
  private queues = new Map<string, Promise<unknown>>()
  constructor(
    private config: PiConfigService,
    private access: FileAccessService
  ) {}

  async ai(): Promise<AiPreferences> {
    const s = await this.config.readSettingsParsed()
    const compaction = object(s.compaction),
      retry = object(s.retry)
    return aiPreferencesSchema.parse({
      defaultThinkingLevel: s.defaultThinkingLevel ?? 'medium',
      compactionEnabled: compaction.enabled ?? true,
      reserveTokens: compaction.reserveTokens ?? 16384,
      keepRecentTokens: compaction.keepRecentTokens ?? 20000,
      retryEnabled: retry.enabled ?? true,
      maxRetries: retry.maxRetries ?? 3
    })
  }
  async saveAi(input: AiPreferences): Promise<AiPreferences> {
    await this.config.patchSettings(
      (s) => ({
        ...s,
        defaultThinkingLevel: input.defaultThinkingLevel,
        compaction: {
          ...object(s.compaction),
          enabled: input.compactionEnabled,
          reserveTokens: input.reserveTokens,
          keepRecentTokens: input.keepRecentTokens
        },
        retry: { ...object(s.retry), enabled: input.retryEnabled, maxRetries: input.maxRetries }
      }),
      { reason: 'AI preferences' }
    )
    return this.ai()
  }

  private async file(
    scope: SettingsScope,
    kind: 'instructions' | 'mcp',
    write = false
  ): Promise<string> {
    const global = path.dirname(this.config.settingsPath())
    if (!scope.root) {
      await fs.mkdir(global, { recursive: true })
      const root = await fs.realpath(global)
      return this.safeTarget(root, kind === 'mcp' ? 'mcp.json' : 'AGENTS.md')
    }
    const root = write
      ? await this.access.assertWritable(scope.root, { mustExist: true })
      : await this.access.assertAllowed(scope.root, { mustExist: true })
    if (!(await fs.stat(root)).isDirectory()) throw new PathDeniedError('Choose a project folder.')
    if (kind === 'instructions') return this.safeTarget(root, 'AGENTS.md')
    const dir = path.join(root, '.pi')
    await this.rejectSymlink(dir)
    if (write) await fs.mkdir(dir, { recursive: true })
    return this.safeTarget(dir, 'mcp.json')
  }
  private async rejectSymlink(file: string): Promise<void> {
    const st = await fs.lstat(file).catch((e) => {
      if (e.code === 'ENOENT') return null
      throw e
    })
    if (st?.isSymbolicLink())
      throw new PathDeniedError('Linked configuration files cannot be edited here.')
  }
  private async safeTarget(root: string, name: string): Promise<string> {
    const file = path.join(root, name)
    await this.rejectSymlink(file)
    return file
  }
  private async read(file: string): Promise<string> {
    const st = await fs.lstat(file).catch((e) => {
      if (e.code === 'ENOENT') return null
      throw e
    })
    if (!st) return ''
    if (!st.isFile() || st.isSymbolicLink() || st.size > 1024 * 1024)
      throw new ConfigError('Configuration file cannot be read.')
    return fs.readFile(file, 'utf8')
  }
  private async mutate<T>(
    file: string,
    revision: string,
    update: (text: string) => string,
    result: () => Promise<T>
  ): Promise<T> {
    const previous = this.queues.get(file) ?? Promise.resolve()
    const work = previous
      .catch(() => undefined)
      .then(async () => {
        const original = await this.read(file)
        if (digest(original) !== revision)
          throw new ConfigConflictError('This file changed. Reload before saving.')
        const next = update(original)
        // Keep a private recovery copy next to the native resource.
        if (original) {
          await atomicWriteText(`${file}.harness-backup`, original)
          await fs.chmod(`${file}.harness-backup`, 0o600)
        }
        if (digest(await this.read(file)) !== revision)
          throw new ConfigConflictError('This file changed. Reload before saving.')
        await atomicWriteText(file, next)
        await fs.chmod(file, 0o600)
        return result()
      })
    this.queues.set(file, work)
    try {
      return await work
    } finally {
      if (this.queues.get(file) === work) this.queues.delete(file)
    }
  }
  async instructions(scope: SettingsScope): Promise<InstructionDocument> {
    const file = await this.file(scope, 'instructions')
    const content = await this.read(file)
    return { path: file, content, revision: digest(content) }
  }
  async saveInstructions(
    input: SettingsScope & { content: string; revision: string }
  ): Promise<InstructionDocument> {
    const file = await this.file(input, 'instructions', true)
    return this.mutate(
      file,
      input.revision,
      () => input.content,
      () => this.instructions(input)
    )
  }
  private parseMcp(text: string): Record<string, unknown> {
    try {
      const value: unknown = text ? JSON.parse(text) : {}
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
      const servers = (value as Record<string, unknown>).mcpServers
      if (
        servers !== undefined &&
        (!servers || typeof servers !== 'object' || Array.isArray(servers))
      )
        throw new Error()
      return value as Record<string, unknown>
    } catch {
      throw new ConfigError('mcp.json is invalid. Correct it before editing servers.')
    }
  }
  async mcp(scope: SettingsScope): Promise<McpInventory> {
    const file = await this.file(scope, 'mcp')
    const text = await this.read(file)
    const json = this.parseMcp(text)
    return {
      path: file,
      revision: digest(text),
      entries: Object.entries(object(json.mcpServers)).map(([id, raw]) => {
        const s = object(raw),
          args = safeArgs(s.args),
          env = referenceFields(s.env),
          headers = referenceFields(s.headers)
        const url = safeUrl(s.url)
        return {
          capability: {
            id: `mcp-${scope.root ? digest(scope.root).slice(0, 12) : 'global'}-${id}`,
            type: 'mcp',
            name: id,
            source: 'local',
            integration: 'native-pi',
            installed: true,
            enabled: s.enabled !== false,
            health: 'unknown',
            ownership: {
              managedBy: 'pi-harness',
              scope: scope.root ? 'project' : 'global',
              readOnly: false
            },
            installPath: file,
            installedVersion: null,
            lastModified: null,
            updateAvailable: false,
            status: s.enabled === false ? 'disabled' : 'installed'
          },
          id,
          type: s.url ? 'http' : 'stdio',
          command: typeof s.command === 'string' ? redactSecretText(s.command) : '',
          args,
          url,
          description: typeof s.description === 'string' ? s.description : '',
          enabled: s.enabled !== false,
          exposure: ['direct', 'deferred', 'hidden'].includes(String(s.exposure))
            ? (s.exposure as 'direct' | 'deferred' | 'hidden')
            : 'codemode',
          env,
          headers,
          protectedFields:
            JSON.stringify(args) !== JSON.stringify(s.args ?? []) ||
            Object.keys(env).length !== Object.keys(object(s.env)).length ||
            Object.keys(headers).length !== Object.keys(object(s.headers)).length ||
            Boolean(s.oauth || s.auth || (s.url && safeUrl(s.url) !== s.url))
        }
      })
    }
  }
  async changeMcp(
    input: SettingsScope & { id: string; revision: string },
    change: (s: Record<string, unknown> | undefined) => Record<string, unknown> | undefined
  ): Promise<McpInventory> {
    const file = await this.file(input, 'mcp', true)
    return this.mutate(
      file,
      input.revision,
      (text) => {
        const json = this.parseMcp(text),
          servers = { ...object(json.mcpServers) }
        const next = change(input.id in servers ? object(servers[input.id]) : undefined)
        if (next)
          Object.defineProperty(servers, input.id, {
            value: next,
            enumerable: true,
            configurable: true,
            writable: true
          })
        else delete servers[input.id]
        return JSON.stringify({ ...json, mcpServers: servers }, null, 2) + '\n'
      },
      () => this.mcp(input)
    )
  }
  async saveMcp(input: McpInput): Promise<McpInventory> {
    return this.changeMcp(input, (old) => {
      const next = {
        ...old,
        type: input.type,
        enabled: input.enabled,
        exposure: input.exposure,
        description: input.description ?? ''
      }
      const result: Record<string, unknown> = next
      if (input.type === 'stdio') {
        result.command =
          old && redactSecretText(String(old.command)) === input.command
            ? old.command
            : input.command
        const masked = safeArgs(old?.args)
        const previous = Array.isArray(old?.args) ? old.args : []
        result.args = (input.args ?? []).map((arg, index) => {
          if (arg === masked[index]) return previous[index] ?? arg
          if (arg.includes('••'))
            throw new ConfigError(
              'Replace hidden credential arguments with environment references before changing their positions.'
            )
          return arg
        })
        result.env = {
          ...Object.fromEntries(
            Object.entries(object(old?.env)).filter(([key]) => !(key in referenceFields(old?.env)))
          ),
          ...input.env
        }
        delete result.url
        delete result.headers
      } else {
        result.url = old && safeUrl(old.url) === input.url ? old.url : input.url
        result.headers = {
          ...Object.fromEntries(
            Object.entries(object(old?.headers)).filter(
              ([key]) => !(key in referenceFields(old?.headers))
            )
          ),
          ...input.headers
        }
        delete result.command
        delete result.args
        delete result.env
        delete result.cwd
      }
      return result
    })
  }
}

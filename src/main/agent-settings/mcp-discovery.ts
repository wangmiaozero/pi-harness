import fs from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { parse as parseToml } from 'smol-toml'
import { parse as parseJsonc, type ParseError } from 'jsonc-parser'
import type {
  McpScanReport,
  McpScanCandidate,
  SettingsScope,
  McpMarketResult
} from '@shared/agent-settings/schema'
import { httpEndpoint, mcpSaveSchema, resourceId } from '@shared/agent-settings/schema'
import {
  MCP_CATALOG,
  type McpCatalogEntry,
  type McpTemplate
} from '@shared/capabilities/mcp-catalog'
import type { FileAccessService } from '../files/file-access-service'
import type { AgentPreferencesService } from './preferences-service'
import { ConfigError } from '../services/errors'
import { redactSecretText } from '../services/logger'

const record = (v: unknown): Record<string, any> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {}
const digest = (v: string) => createHash('sha256').update(v).digest('hex').slice(0, 24)
export class McpDiscoveryService {
  private registry = new Map<string, { entry: McpCatalogEntry; at: number }>()
  constructor(
    private preferences: AgentPreferencesService,
    private access: FileAccessService,
    private home = os.homedir()
  ) {}
  async scan(scope: SettingsScope): Promise<McpScanReport> {
    const home = this.home,
      root = scope.root
        ? await this.access.assertAllowed(scope.root, { mustExist: true })
        : undefined
    const configHome =
      process.platform === 'darwin'
        ? path.join(home, 'Library', 'Application Support')
        : process.platform === 'win32'
          ? path.join(home, 'AppData', 'Roaming')
          : path.join(home, '.config')
    const sources = [
      {
        name: 'Claude Desktop',
        file: path.join(configHome, 'Claude', 'claude_desktop_config.json'),
        base: home
      },
      { name: 'Claude Code', file: path.join(home, '.claude.json'), base: home },
      { name: 'Claude Code', file: path.join(home, '.claude', 'settings.json'), base: home },
      { name: 'Cursor', file: path.join(home, '.cursor', 'mcp.json'), base: home },
      {
        name: 'Windsurf',
        file: path.join(home, '.codeium', 'windsurf', 'mcp_config.json'),
        base: home
      },
      { name: 'Codex', file: path.join(home, '.codex', 'config.toml'), base: home },
      {
        name: 'OpenCode',
        file: path.join(home, '.config', 'opencode', 'opencode.json'),
        base: home
      },
      { name: 'OpenCode', file: path.join(home, '.opencode.json'), base: home },
      ...(root
        ? [
            { name: 'Cursor · project', file: path.join(root, '.cursor', 'mcp.json'), base: root },
            { name: 'Claude Code · project', file: path.join(root, '.mcp.json'), base: root },
            { name: 'VS Code · project', file: path.join(root, '.vscode', 'mcp.json'), base: root },
            { name: 'OpenCode · project', file: path.join(root, 'opencode.json'), base: root }
          ]
        : [])
    ]
    const result: McpScanReport = { candidates: [], sources: [] }
    for (const source of sources) {
      const report: McpScanReport['sources'][number] = {
        name: source.name,
        path: source.file.startsWith(home)
          ? '~' + source.file.slice(home.length)
          : path.relative(source.base, source.file),
        status: 'missing',
        count: 0
      }
      result.sources.push(report)
      try {
        const stat = await fs.stat(source.file)
        if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error()
        const real = await fs.realpath(source.file),
          base = await fs.realpath(source.base)
        const relative = path.relative(base, real)
        if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error()
        const handle = await fs.open(real, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
        let text: string
        try {
          if (!(await handle.stat()).isFile()) throw new Error()
          const buffer = Buffer.alloc(1024 * 1024 + 1)
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
          if (bytesRead > 1024 * 1024) throw new Error()
          text = buffer.subarray(0, bytesRead).toString('utf8')
        } finally {
          await handle.close()
        }
        let json: Record<string, any>
        if (source.file.endsWith('.toml')) json = record(parseToml(text))
        else {
          const errors: ParseError[] = []
          json = record(parseJsonc(text, errors))
          if (errors.length) throw new Error()
        }
        const servers = record(json.mcpServers ?? json.mcp_servers ?? json.mcp ?? json.servers)
        report.status = 'read'
        for (const [name, raw] of Object.entries(servers).slice(0, 100)) {
          const candidate = this.candidate(source.name, name, raw, `${source.file}:${name}`)
          if (candidate) {
            result.candidates.push(candidate)
            report.count++
          }
        }
      } catch (e) {
        report.status = (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'error'
      }
    }
    return result
  }
  private candidate(
    source: string,
    name: string,
    value: unknown,
    key: string
  ): McpScanCandidate | null {
    const raw = record(value),
      warnings: string[] = []
    let blocked = false
    const safe = (v: string): string => {
      const clean = redactSecretText(v).replace(
        /((?:api[-_]?key|token|password|secret|authorization)=).+/gi,
        '$1[redacted]'
      )
      if (clean !== v) {
        blocked = true
        warnings.push('credentials')
      }
      return clean
    }
    const map = (value: unknown): Record<string, string> =>
      Object.fromEntries(
        Object.entries(record(value)).flatMap(([key, v]) => {
          if (typeof v === 'string' && /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(v)) return [[key, v]]
          blocked = true
          warnings.push('credentials')
          return []
        })
      )
    const id =
      name
        .replace(/[^a-zA-Z0-9_.-]/g, '-')
        .replace(/^[^a-zA-Z0-9]+/, '')
        .slice(0, 100) || `server-${digest(key)}`
    if (!resourceId.safeParse(id).success) return null
    const url = typeof raw.url === 'string' ? raw.url : ''
    const command = Array.isArray(raw.command) ? raw.command[0] : raw.command
    const rawArgs = Array.isArray(raw.command) ? raw.command.slice(1) : (raw.args ?? [])
    let secretNext = false
    const args = Array.isArray(rawArgs)
      ? rawArgs.map((arg) => {
          if (typeof arg !== 'string') {
            blocked = true
            return ''
          }
          const isSecret = secretNext
          secretNext = /^--?(?:api[-_]?key|token|password|secret|authorization)$/i.test(arg)
          if (isSecret) {
            blocked = true
            warnings.push('credentials')
            return '[redacted]'
          }
          return safe(arg)
        })
      : []
    if (raw.oauth || raw.auth || raw.bearer_token_env_var) {
      blocked = true
      warnings.push('authorization')
    }
    let endpoint = url
    if (url) {
      try {
        const parsed = new URL(url)
        if (parsed.username || parsed.password || parsed.search || parsed.hash) {
          blocked = true
          warnings.push('credentials')
          parsed.username = ''
          parsed.password = ''
          parsed.search = ''
          parsed.hash = ''
          endpoint = parsed.toString()
        }
      } catch {
        return null
      }
    }
    const input = {
      id,
      type: url ? ('http' as const) : ('stdio' as const),
      enabled: false,
      exposure: 'codemode' as const,
      description: typeof raw.description === 'string' ? safe(raw.description).slice(0, 2000) : '',
      ...(url
        ? { url: endpoint, headers: map(raw.headers ?? raw.http_headers) }
        : {
            command: typeof command === 'string' ? safe(command) : '',
            args,
            env: map(raw.env ?? raw.environment)
          })
    }
    const parsed = mcpSaveSchema.safeParse({ ...input, revision: '0'.repeat(64) })
    if (!parsed.success) return null
    const { revision: _revision, ...template } = parsed.data
    void _revision
    return { key: digest(key), source, template, blocked, warnings: [...new Set(warnings)] }
  }
  async market(query: string, cursor?: string): Promise<McpMarketResult> {
    const builtins = cursor
      ? []
      : MCP_CATALOG.filter((entry) =>
          `${entry.capability.name} ${entry.capability.description} ${entry.category}`
            .toLowerCase()
            .includes(query.toLowerCase())
        )
    try {
      const url = new URL('https://registry.modelcontextprotocol.io/v0/servers')
      url.searchParams.set('limit', '50')
      url.searchParams.set('version', 'latest')
      if (query) url.searchParams.set('search', query)
      if (cursor) url.searchParams.set('cursor', cursor)
      const response = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: 'error' })
      if (!response.ok || !response.body) throw new Error()
      const reader = response.body.getReader(),
        decoder = new TextDecoder()
      let text = '',
        size = 0
      try {
        for (;;) {
          const part = await reader.read()
          if (part.done) break
          size += part.value.length
          if (size > 4 * 1024 * 1024) {
            await reader.cancel()
            throw new Error()
          }
          text += decoder.decode(part.value, { stream: true })
        }
        text += decoder.decode()
      } finally {
        reader.releaseLock()
      }
      const json = record(JSON.parse(text)),
        entries = [...builtins]
      for (const item of (Array.isArray(json.servers) ? json.servers : []).slice(0, 50)) {
        const server = record(record(item).server ?? item),
          name = typeof server.name === 'string' ? server.name.slice(0, 200) : ''
        const remote = Array.isArray(server.remotes)
          ? server.remotes.find(
              (r: any) =>
                r.type === 'streamable-http' &&
                httpEndpoint.safeParse(r.url).success &&
                !String(r.url).includes('{')
            )
          : null
        const npm = Array.isArray(server.packages)
          ? server.packages.find((value: unknown) => {
              const pkg = record(value)
              return (
                pkg.registryType === 'npm' &&
                record(pkg.transport).type === 'stdio' &&
                typeof pkg.identifier === 'string' &&
                /^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/i.test(pkg.identifier) &&
                typeof pkg.version === 'string' &&
                /^(?:latest|\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?)$/i.test(pkg.version) &&
                (!pkg.packageArguments ||
                  (Array.isArray(pkg.packageArguments) && pkg.packageArguments.length === 0)) &&
                (!pkg.runtimeArguments ||
                  (Array.isArray(pkg.runtimeArguments) && pkg.runtimeArguments.length === 0))
              )
            })
          : null
        if (!name || (!remote && !npm)) continue
        const id = `registry-${digest(name + JSON.stringify(remote ?? npm))}`
        const template: McpTemplate = {
          id,
          ...(remote
            ? { type: 'http' as const, url: remote.url }
            : {
                type: 'stdio' as const,
                command: 'npx',
                args: ['-y', `${npm.identifier}@${npm.version}`],
                env: Object.fromEntries(
                  (Array.isArray(npm.environmentVariables) ? npm.environmentVariables : []).flatMap(
                    (variable: unknown) => {
                      const v = record(variable)
                      return typeof v.name === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(v.name)
                        ? [[v.name, '${' + v.name + '}']]
                        : []
                    }
                  )
                )
              }),
          enabled: false,
          exposure: 'codemode',
          description:
            typeof server.description === 'string' ? server.description.slice(0, 2000) : ''
        }
        if (!mcpSaveSchema.safeParse({ ...template, revision: '0'.repeat(64) }).success) continue
        const entry: McpCatalogEntry = {
          capability: {
            id,
            type: 'mcp',
            name,
            description: template.description,
            source: 'marketplace',
            integration: 'native-pi'
          },
          category: 'devtools',
          template,
          notes: 'Review service authorization before enabling.'
        }
        this.registry.set(id, { entry, at: Date.now() })
        entries.push(entry)
      }
      for (const [id, cached] of this.registry)
        if (Date.now() - cached.at > 10 * 60000 || this.registry.size > 500)
          this.registry.delete(id)
      const nextCursor =
        typeof json.metadata?.nextCursor === 'string' && json.metadata.nextCursor.length <= 1024
          ? json.metadata.nextCursor
          : undefined
      return { entries, ...(nextCursor ? { nextCursor } : {}), offline: false }
    } catch {
      return { entries: [...builtins], offline: true }
    }
  }
  async install(input: { catalogId: string; revision: string; root?: string; folder?: string }) {
    const entry =
      MCP_CATALOG.find((e) => e.capability.id === input.catalogId) ??
      (Date.now() - (this.registry.get(input.catalogId)?.at ?? 0) < 10 * 60000
        ? this.registry.get(input.catalogId)?.entry
        : undefined)
    if (!entry) throw new ConfigError('Reload the market before installing this server.')
    const inventory = await this.preferences.mcp(input.root ? { root: input.root } : {})
    if (inventory.entries.some((e) => e.id === entry.template.id))
      throw new ConfigError('This server is already configured.')
    let template = entry.template
    if (entry.requiresRoot) {
      if (!input.folder) throw new ConfigError('Choose a project folder for this server.')
      const folder = await this.access.assertAllowed(input.folder, { mustExist: true })
      template = { ...template, args: [...(template.args ?? []), folder] }
    }
    return this.preferences.saveMcp(
      mcpSaveSchema.parse({
        ...template,
        ...(input.root ? { root: input.root } : {}),
        revision: input.revision
      })
    )
  }
}

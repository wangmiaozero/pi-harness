import { open, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AppSettings } from '@shared/ipc/api-types'
import type { JsonStore } from '../services/storage'
import { getPiConfigDir } from '../services/app-paths'
import { log } from '../services/logger'
import { NotFoundError } from '../services/errors'
import type {
  AgentMessage,
  SessionContext,
  SessionDetail,
  SessionEntry,
  SessionHeader,
  SessionInfo
} from '@shared/types/workspace'
import { sessionPathKey } from '@shared/workspace/session-path'
import { projectIdentityKey } from '@shared/workspace/project-identity'
import { normalizeToolCalls } from '@shared/workspace/normalize'
import { loadPiCodingAgent, type PiSessionInfoLike } from '../agent/pi-sdk'
import type { WorktreeService } from '../git/worktree-service'
import type { FileAccessService } from '../files/file-access-service'
import { summarizeSessionTitle } from '@shared/workspace/session-title'
import type { SessionTitleService } from './session-title-service'
import { SessionIndexClient, type SessionIndex } from './session-index-client'
import { atomicWriteText } from '../services/storage'

export class SessionService {
  private pathCache = new Map<string, string>()
  private pathToId = new Map<string, string>()
  private listCache: { data: SessionInfo[]; ts: number } | null = null
  private listPromise: Promise<SessionInfo[]> | null = null
  private listRevision = 0
  private closed = false

  constructor(
    private readonly settingsStore: JsonStore<AppSettings>,
    private readonly worktrees: WorktreeService,
    private readonly access: FileAccessService,
    private readonly index: SessionIndex = new SessionIndexClient(),
    private readonly titles?: SessionTitleService
  ) {}

  sessionsRoot(): string {
    const settings = this.settingsStore.peek()
    return path.join(getPiConfigDir(settings.manualConfigDir), 'sessions')
  }

  async createEmpty(cwd: string): Promise<SessionInfo> {
    if (this.closed) throw new Error('Session service is closed')
    const sdk = await loadPiCodingAgent()
    const manager = sdk.SessionManager.create(
      cwd,
      path.join(this.sessionsRoot(), '--desktop-chats--')
    )
    const header = manager.getHeader()
    const file = manager.getSessionFile()
    if (!header || !file) throw new Error('Native session could not be created')
    // An explicit new-conversation action persists only Pi's own header. No
    // synthetic user/assistant message or running agent is needed for an empty chat.
    await atomicWriteText(file, JSON.stringify(header) + '\n')
    this.invalidate()
    this.cachePath(header.id, file)
    const detail = await this.get(header.id)
    if (!detail.info) throw new Error('Native session header is missing')
    const [info] = await this.attachProjects([detail.info])
    return { ...info, transient: false }
  }

  invalidate(): void {
    this.listRevision++
    this.listCache = null
    this.listPromise = null
    this.pathCache.clear()
    this.pathToId.clear()
    this.access.invalidate()
  }

  cachePath(sessionId: string, filePath: string): void {
    const normalized = path.normalize(filePath)
    const key = sessionPathKey(normalized)
    this.pathCache.set(sessionId, normalized)
    this.pathToId.set(key, sessionId)
  }

  async list(force = false): Promise<SessionInfo[]> {
    if (this.closed) throw new Error('Session service is closed')
    if (force) this.invalidate()
    if (this.listCache && Date.now() - this.listCache.ts < 30_000) return this.listCache.data
    if (this.listPromise) return this.listPromise

    const revision = this.listRevision
    const request = this.loadAll()
      .then((data) => {
        // A refresh/mutation may have started a newer scan while this one ran.
        if (revision !== this.listRevision) return this.list()
        for (const session of data) this.cachePath(session.id, session.path)
        this.listCache = { data, ts: Date.now() }
        return data
      })
      .finally(() => {
        if (this.listPromise === request) this.listPromise = null
      })
    this.listPromise = request
    return request
  }

  async close(): Promise<void> {
    this.closed = true
    this.titles?.close()
    this.invalidate()
    await this.index.close()
  }

  async resolvePath(sessionId: string): Promise<string | null> {
    const cached = this.pathCache.get(sessionId)
    if (cached) {
      try {
        if ((await stat(cached)).isFile()) return cached
      } catch {
        this.pathCache.delete(sessionId)
        this.pathToId.delete(sessionPathKey(cached))
      }
    }
    await this.list()
    const resolved = this.pathCache.get(sessionId)
    if (!resolved) return null
    try {
      return (await stat(resolved)).isFile() ? resolved : null
    } catch {
      this.pathCache.delete(sessionId)
      this.pathToId.delete(sessionPathKey(resolved))
      return null
    }
  }

  async resolveIdByPath(filePath: string): Promise<string | undefined> {
    const key = sessionPathKey(filePath)
    const cached = this.pathToId.get(key)
    if (cached) return cached
    await this.list()
    return this.pathToId.get(key)
  }

  async get(sessionId: string, leafId?: string | null): Promise<SessionDetail> {
    const filePath = await this.resolvePath(sessionId)
    if (!filePath) throw new NotFoundError(`Session not found: ${sessionId}`)
    // Header and entry scans read the file independently; run them together.
    const [entries, header] = await Promise.all([
      this.readEntries(filePath),
      readSessionHeader(filePath)
    ])
    const resolvedLeaf = leafId ?? lastEntryId(entries)
    const context = await this.buildContext(entries, resolvedLeaf)
    const info = await this.infoFromHeader(filePath, header, context, latestSessionName(entries))
    const detail: SessionDetail = {
      sessionId,
      filePath,
      info,
      leafId: resolvedLeaf,
      context,
      totalActiveMs: computeSessionTotalActiveMs(entries)
    }
    this.titles?.observe(detail)
    return { ...detail, info: this.withTitle(info, context) }
  }

  async getFullHistory(sessionId: string): Promise<SessionDetail> {
    const filePath = await this.requirePath(sessionId)
    // Header and entry scans read the file independently; run them together.
    const [entries, header] = await Promise.all([
      this.readEntries(filePath),
      readSessionHeader(filePath)
    ])
    const resolvedLeaf = lastEntryId(entries)
    const activeContext = await this.buildContext(entries, resolvedLeaf)
    const messages: AgentMessage[] = []
    const entryIds: string[] = []
    for (const entry of entries) {
      const message = entryToUiMessage({ ...entry })
      if (!message) continue
      messages.push(message)
      entryIds.push(entry.id)
    }
    const context: SessionContext = {
      ...activeContext,
      messages,
      entryIds,
      entryParents: Object.fromEntries(entries.map((entry) => [entry.id, entry.parentId]))
    }
    return {
      sessionId,
      filePath,
      info: this.withTitle(
        await this.infoFromHeader(filePath, header, context, latestSessionName(entries)),
        context
      ),
      leafId: resolvedLeaf,
      context,
      totalActiveMs: computeSessionTotalActiveMs(entries)
    }
  }

  async rename(sessionId: string, name: string): Promise<void> {
    const filePath = await this.requirePath(sessionId)
    const sdk = await loadPiCodingAgent()
    sdk.SessionManager.open(filePath).appendSessionInfo(name)
    this.invalidate()
  }

  async remove(sessionId: string): Promise<void> {
    const filePath = await this.resolvePath(sessionId)
    if (!filePath) return
    const header = await readSessionHeader(filePath)
    const parentSessionPath = header?.parentSession
    const dir = path.dirname(filePath)
    const targetKey = sessionPathKey(filePath)
    try {
      const files = await readdir(dir)
      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue
        const childPath = path.join(dir, file)
        if (sessionPathKey(childPath) === targetKey) continue
        try {
          const content = await readFile(childPath, 'utf8')
          const lines = content.split('\n')
          const childHeader = JSON.parse(lines[0] ?? '{}') as {
            type?: string
            parentSession?: string
          }
          if (
            childHeader.type === 'session' &&
            childHeader.parentSession &&
            sessionPathKey(childHeader.parentSession) === targetKey
          ) {
            childHeader.parentSession = parentSessionPath
            lines[0] = JSON.stringify(childHeader)
            await writeFile(childPath, lines.join('\n'))
          }
        } catch {
          /* skip malformed sibling */
        }
      }
    } catch {
      /* dir unreadable */
    }
    await unlink(filePath)
    this.pathCache.delete(sessionId)
    this.invalidate()
  }

  /** Raw JSONL entries for Harness run reconstruction and evaluation evidence. */
  async readRawEntries(sessionId: string): Promise<SessionEntry[]> {
    const filePath = await this.resolvePath(sessionId)
    if (!filePath) return []
    return this.readEntries(filePath)
  }

  async buildContext(entries: SessionEntry[], leafId?: string | null): Promise<SessionContext> {
    const sdk = await loadPiCodingAgent()
    const nativeEntries = sdk
      .parseSessionEntries(entries.map((entry) => JSON.stringify(entry)).join('\n'))
      .filter((entry) => entry.type !== 'session')
    const byId = new Map(nativeEntries.map((entry) => [entry.id, entry]))
    const contextEntries = sdk.buildContextEntries(nativeEntries, leafId, byId)
    const piContext = sdk.buildSessionContext(nativeEntries, leafId, byId)
    const messages: AgentMessage[] = []
    const entryIds: string[] = []
    for (const entry of contextEntries) {
      const message = entryToUiMessage({ ...entry })
      if (message) {
        messages.push(message)
        entryIds.push(entry.id)
      }
    }
    return {
      messages,
      entryIds,
      entryParents: Object.fromEntries(entries.map((entry) => [entry.id, entry.parentId])),
      thinkingLevel: piContext.thinkingLevel,
      model: piContext.model
    }
  }

  private async requirePath(sessionId: string): Promise<string> {
    const filePath = await this.resolvePath(sessionId)
    if (!filePath) throw new NotFoundError(`Session not found: ${sessionId}`)
    return filePath
  }

  private async loadAll(): Promise<SessionInfo[]> {
    let piSessions: PiSessionInfoLike[]
    try {
      piSessions = await this.index.list()
    } catch (error) {
      if (this.closed) throw error
      // The packaged worker can be unavailable; both readers use the same Native SDK.
      log.session.warn('Background session index unavailable, using Main reader:', error)
      const sdk = await loadPiCodingAgent()
      piSessions = await sdk.SessionManager.listAll()
    }
    const pathToId = new Map(
      piSessions.map((session) => [sessionPathKey(session.path), session.id] as const)
    )
    return this.attachProjects(piSessions.map((session) => this.fromPi(session, pathToId)))
  }

  private fromPi(s: PiSessionInfoLike, pathToId: ReadonlyMap<string, string>): SessionInfo {
    return {
      path: s.path,
      id: s.id,
      cwd: s.cwd,
      name:
        s.name ||
        (s.messageCount > 0
          ? this.titles?.title(s) || s.suggestedTitle || summarizeSessionTitle([s.firstMessage])
          : undefined),
      created: s.created instanceof Date ? s.created.toISOString() : String(s.created),
      modified: s.modified instanceof Date ? s.modified.toISOString() : String(s.modified),
      messageCount: s.messageCount,
      firstMessage: s.firstMessage || '(no messages)',
      parentSessionId: s.parentSessionPath
        ? pathToId.get(sessionPathKey(s.parentSessionPath))
        : undefined,
      transient: false
    }
  }

  private async attachProjects(sessions: SessionInfo[]): Promise<SessionInfo[]> {
    const uniqueCwds = [...new Set(sessions.map((s) => s.cwd).filter(Boolean))]
    const projectByCwd = new Map<
      string,
      { projectRoot: string; branch: string | null; isWorktree: boolean }
    >()
    await Promise.all(
      uniqueCwds.map(async (cwd) => {
        try {
          projectByCwd.set(cwd, await this.worktrees.resolveProject(cwd))
        } catch {
          projectByCwd.set(cwd, { projectRoot: cwd, branch: null, isWorktree: false })
        }
      })
    )
    return sessions.map((session) => {
      const project = session.cwd ? projectByCwd.get(session.cwd) : undefined
      const projectRoot = project?.projectRoot ?? session.cwd
      return {
        ...session,
        projectRoot,
        projectKey: projectIdentityKey(projectRoot),
        ...(project?.isWorktree && project.branch ? { worktreeBranch: project.branch } : {})
      }
    })
  }

  private async infoFromHeader(
    filePath: string,
    header: SessionHeader | null,
    context: SessionContext,
    name?: string
  ): Promise<SessionInfo | null> {
    if (!header) return null
    let modified = header.timestamp
    try {
      modified = (await stat(filePath)).mtime.toISOString()
    } catch {
      /* keep header timestamp */
    }
    const firstUser = context.messages.find((m) => m.role === 'user')
    let firstMessage = '(no messages)'
    if (firstUser) {
      if (typeof firstUser.content === 'string') {
        firstMessage = firstUser.content
      } else {
        const firstText = firstUser.content.find(
          (block) => block.type === 'text' && block.text.trim()
        )
        firstMessage =
          firstText?.type === 'text'
            ? firstText.text
            : firstUser.content.some((block) => block.type === 'image')
              ? '[image]'
              : '(no messages)'
      }
    }
    return {
      path: filePath,
      id: header.id,
      name,
      cwd: header.cwd ?? '',
      created: header.timestamp,
      modified,
      messageCount: context.messages.length,
      firstMessage,
      parentSessionId: header.parentSession
        ? await this.resolveIdByPath(header.parentSession)
        : undefined
    }
  }

  private withTitle(info: SessionInfo | null, context: SessionContext): SessionInfo | null {
    if (!info || info.name || context.messages.length === 0) return info
    const texts = context.messages
      .filter((message) => message.role === 'user')
      .map((message) =>
        typeof message.content === 'string'
          ? message.content
          : message.content
              .filter((block) => block.type === 'text')
              .map((block) => (block.type === 'text' ? block.text : ''))
              .join('\n')
      )
    return { ...info, name: this.titles?.title(info) || summarizeSessionTitle(texts) }
  }

  private async readEntries(filePath: string): Promise<SessionEntry[]> {
    const sdk = await loadPiCodingAgent()
    const entries = sdk.parseSessionEntries(await readFile(filePath, 'utf8'))
    // Native migrations run in memory while browsing; the original JSONL stays unchanged.
    sdk.migrateSessionEntries(entries)
    return entries.filter((entry) => entry.type !== 'session').map((entry) => ({ ...entry }))
  }
}

export async function readSessionHeader(filePath: string): Promise<SessionHeader | null> {
  const fh = await open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(64 * 1024)
    const { bytesRead } = await fh.read(buffer, 0, buffer.length, 0)
    const data = buffer.subarray(0, bytesRead)
    const newline = data.indexOf(0x0a)
    if (newline === -1) return null
    const firstLine = data.subarray(0, newline).toString('utf8').trimEnd()
    if (!firstLine) return null
    const header = JSON.parse(firstLine) as SessionHeader
    return header.type === 'session' ? header : null
  } catch {
    return null
  } finally {
    await fh.close()
  }
}

function latestSessionName(entries: readonly SessionEntry[]): string | undefined {
  const entry = [...entries].reverse().find((entry) => entry.type === 'session_info')
  return typeof entry?.name === 'string' ? entry.name.trim() || undefined : undefined
}

function lastEntryId(entries: SessionEntry[]): string | null {
  return entries.at(-1)?.id ?? null
}

export function computeSessionTotalActiveMs(entries: readonly SessionEntry[]): number {
  let total = 0
  let previous: number | undefined
  for (const entry of entries) {
    if (!['message', 'compaction', 'branch_summary', 'custom_message'].includes(entry.type))
      continue
    const timestamp = Date.parse(entry.timestamp)
    if (!Number.isFinite(timestamp)) continue
    const role =
      entry.type === 'message' ? (entry.message as { role?: string } | undefined)?.role : undefined
    if (role === 'user' || role === 'bashExecution') {
      previous = timestamp
      continue
    }
    if (previous !== undefined && timestamp > previous) total += timestamp - previous
    previous = timestamp
  }
  return total
}

export function entryToUiMessage(entry: SessionEntry): AgentMessage | null {
  switch (entry.type) {
    case 'message': {
      const message = entry.message as AgentMessage | undefined
      if (message?.role === 'custom' && !message.display) return null
      if (message?.role === 'custom' && message.customType === 'pi-harness-image-result') {
        const details =
          message.details && typeof message.details === 'object'
            ? (message.details as { provider?: unknown; model?: unknown })
            : {}
        const content = Array.isArray(message.content)
          ? message.content.filter((block) => block.type === 'image')
          : []
        if (!content.length) return null
        return {
          role: 'assistant',
          content,
          provider: typeof details.provider === 'string' ? details.provider : 'image',
          model: typeof details.model === 'string' ? details.model : 'image',
          stopReason: 'stop',
          timestamp: message.timestamp
        }
      }
      return message ? normalizeToolCalls(message) : null
    }
    case 'compaction':
      return {
        role: 'custom',
        customType: 'compaction',
        content: String(entry.summary ?? ''),
        display: true,
        details: {
          tokensBefore: entry.tokensBefore,
          firstKeptEntryId: entry.firstKeptEntryId
        }
      }
    case 'branch_summary':
      if (!entry.summary) return null
      return {
        role: 'user',
        content: `*The conversation briefly explored another branch and returned with this summary:*\n\n${String(entry.summary)}`
      }
    case 'custom_message': {
      if (!entry.display) return null
      const content = entry.content
      return {
        role: 'custom',
        customType: String(entry.customType ?? 'custom'),
        content: typeof content === 'string' || Array.isArray(content) ? content : '',
        display: Boolean(entry.display),
        details: entry.details
      }
    }
    default:
      return null
  }
}

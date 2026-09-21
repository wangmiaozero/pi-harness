/**
 * Session registry RPC service (phase 2).
 *
 * Ports the Electron main `SessionService` (list / get / rename / remove /
 * context) onto the runtime sidecar. Differences from Electron:
 * - No worktree/project attachment (workspace/git phases) — the renderer's
 *   `groupSessionsByProject` falls back to `session.cwd`.
 * - No fs-permission boundary: the host (Rust) owns that; the runtime only
 *   sees paths under the Pi agent dir plus cwd paths passed to agent.start.
 */

import { open, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  AgentMessage,
  SessionContext,
  SessionDetail,
  SessionEntry,
  SessionHeader,
  SessionInfo
} from '../types.js'
import { sessionPathKey } from '../support/session-path.js'
import { normalizeToolCalls } from '../support/normalize.js'
import { RuntimeError } from '../pi/errors.js'
import type { PiSdkLoader } from '../pi/types.js'

const LIST_CACHE_MS = 30_000

/** Diagnostics sink — index.ts wires this to stderr. */
export type LogFn = (message: string) => void

export class SessionService {
  private pathCache = new Map<string, string>()
  private pathToId = new Map<string, string>()
  private listCache: { data: SessionInfo[]; ts: number } | null = null
  private listPromise: Promise<SessionInfo[]> | null = null

  constructor(
    private readonly loadSdk: PiSdkLoader,
    private readonly log: LogFn = () => {}
  ) {}

  sessionsRoot(sdk: { getAgentDir(): string }): string {
    return path.join(sdk.getAgentDir(), 'sessions')
  }

  invalidate(): void {
    this.listCache = null
    this.listPromise = null
    this.pathCache.clear()
    this.pathToId.clear()
  }

  cachePath(sessionId: string, filePath: string): void {
    const normalized = path.normalize(filePath)
    this.pathCache.set(sessionId, normalized)
    this.pathToId.set(sessionPathKey(normalized), sessionId)
  }

  async list(force = false): Promise<SessionInfo[]> {
    if (force) this.invalidate()
    if (this.listCache && Date.now() - this.listCache.ts < LIST_CACHE_MS) return this.listCache.data
    if (this.listPromise) return this.listPromise

    this.listPromise = this.loadAll()
      .then((data) => {
        this.listCache = { data, ts: Date.now() }
        return data
      })
      .finally(() => {
        this.listPromise = null
      })
    return this.listPromise
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
    const filePath = await this.requirePath(sessionId)
    const entries = await this.readEntries(filePath)
    const resolvedLeaf = leafId ?? lastEntryId(entries)
    const context = await this.buildContext(entries, resolvedLeaf)
    const header = await readSessionHeader(filePath)
    const info = await this.infoFromHeader(filePath, header, context)
    return {
      sessionId,
      filePath,
      info,
      leafId: resolvedLeaf,
      context,
      totalActiveMs: computeSessionTotalActiveMs(entries)
    }
  }

  async getFullHistory(sessionId: string): Promise<SessionDetail> {
    const filePath = await this.requirePath(sessionId)
    const entries = await this.readEntries(filePath)
    const resolvedLeaf = lastEntryId(entries)
    const activeContext = await this.buildContext(entries, resolvedLeaf)
    const messages: AgentMessage[] = []
    const entryIds: string[] = []
    for (const entry of entries) {
      const message = entryToUiMessage(entry)
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
    const header = await readSessionHeader(filePath)
    return {
      sessionId,
      filePath,
      info: await this.infoFromHeader(filePath, header, context),
      leafId: resolvedLeaf,
      context,
      totalActiveMs: computeSessionTotalActiveMs(entries)
    }
  }

  async rename(sessionId: string, name: string): Promise<void> {
    const filePath = await this.requirePath(sessionId)
    try {
      const sdk = await this.loadSdk()
      const sm = sdk.SessionManager.open(filePath)
      if (typeof sm.appendSessionInfo === 'function') {
        sm.appendSessionInfo(name)
      } else {
        await appendSessionInfoLine(filePath, name)
      }
    } catch (raw) {
      this.log(`appendSessionInfo failed, appending line directly: ${String(raw)}`)
      await appendSessionInfoLine(filePath, name)
    }
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

  /** Raw JSONL entries (harness run reconstruction, later phases). */
  async readRawEntries(sessionId: string): Promise<SessionEntry[]> {
    const filePath = await this.resolvePath(sessionId)
    if (!filePath) return []
    return this.readEntries(filePath)
  }

  async buildContext(entries: SessionEntry[], leafId?: string | null): Promise<SessionContext> {
    try {
      const sdk = await this.loadSdk()
      if (sdk.buildContextEntries && sdk.buildSessionContext) {
        const byId = new Map(entries.map((e) => [e.id, e] as const))
        const contextEntries = sdk.buildContextEntries(entries, leafId, byId) as SessionEntry[]
        const piCtx = sdk.buildSessionContext(entries, leafId, byId)
        const messages: AgentMessage[] = []
        const entryIds: string[] = []
        for (const entry of contextEntries) {
          const message = entryToUiMessage(entry)
          if (message) {
            messages.push(message)
            entryIds.push(entry.id)
          }
        }
        return {
          messages,
          entryIds,
          entryParents: Object.fromEntries(entries.map((e) => [e.id, e.parentId])),
          thinkingLevel: piCtx.thinkingLevel ?? 'off',
          model: piCtx.model
            ? {
                provider: String(piCtx.model.provider ?? ''),
                modelId: String(piCtx.model.modelId ?? '')
              }
            : null
        }
      }
    } catch (raw) {
      this.log(`SDK context builder unavailable, using parentId walk: ${String(raw)}`)
    }
    return walkContext(entries, leafId)
  }

  private async requirePath(sessionId: string): Promise<string> {
    const filePath = await this.resolvePath(sessionId)
    if (!filePath) throw new RuntimeError('SESSION_NOT_FOUND', `Session not found: ${sessionId}`)
    return filePath
  }

  private async loadAll(): Promise<SessionInfo[]> {
    try {
      const sdk = await this.loadSdk()
      const piSessions = await sdk.SessionManager.listAll()
      const pathToId = new Map(
        piSessions.map((session) => [sessionPathKey(session.path), session.id] as const)
      )
      return piSessions.map((session) => this.fromPi(session, pathToId))
    } catch (raw) {
      this.log(`SessionManager.listAll failed, scanning JSONL: ${String(raw)}`)
      return this.scanJsonl()
    }
  }

  private fromPi(
    s: {
      path: string
      id: string
      cwd: string
      name?: string
      created: Date | string
      modified: Date | string
      messageCount: number
      firstMessage?: string
      parentSessionPath?: string
    },
    pathToId: ReadonlyMap<string, string>
  ): SessionInfo {
    this.cachePath(s.id, s.path)
    return {
      path: s.path,
      id: s.id,
      cwd: s.cwd,
      name: s.name,
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

  private async scanJsonl(): Promise<SessionInfo[]> {
    let root: string
    try {
      const sdk = await this.loadSdk()
      root = this.sessionsRoot(sdk)
    } catch {
      return []
    }
    const results: SessionInfo[] = []
    const parentPathById = new Map<string, string>()
    let cwdDirs: string[] = []
    try {
      cwdDirs = await readdir(root)
    } catch {
      return []
    }
    for (const cwdDir of cwdDirs) {
      const dir = path.join(root, cwdDir)
      let files: string[] = []
      try {
        files = await readdir(dir)
      } catch {
        continue
      }
      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue
        const filePath = path.join(dir, file)
        try {
          const header = await readSessionHeader(filePath)
          if (!header) continue
          const st = await stat(filePath)
          const info: SessionInfo = {
            path: filePath,
            id: header.id,
            cwd: header.cwd,
            created: header.timestamp,
            modified: st.mtime.toISOString(),
            messageCount: 0,
            firstMessage: '(no messages)',
            parentSessionId: undefined
          }
          this.cachePath(header.id, filePath)
          if (header.parentSession) parentPathById.set(header.id, header.parentSession)
          results.push(info)
        } catch {
          /* skip */
        }
      }
    }
    for (const item of results) {
      const parentPath = parentPathById.get(item.id)
      if (parentPath) item.parentSessionId = this.pathToId.get(sessionPathKey(parentPath))
    }
    return results.sort((a, b) => b.modified.localeCompare(a.modified))
  }

  private async infoFromHeader(
    filePath: string,
    header: SessionHeader | null,
    context: SessionContext
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

  private async readEntries(filePath: string): Promise<SessionEntry[]> {
    try {
      const sdk = await this.loadSdk()
      return sdk.SessionManager.open(filePath).getEntries() as SessionEntry[]
    } catch {
      const text = await readFile(filePath, 'utf8')
      const entries: SessionEntry[] = []
      for (const line of text.split('\n')) {
        if (!line.trim()) continue
        try {
          const parsed = JSON.parse(line) as SessionEntry & { type?: string }
          if (parsed.type && parsed.type !== 'session' && typeof parsed.id === 'string') {
            entries.push(parsed)
          }
        } catch {
          /* skip */
        }
      }
      return entries
    }
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

async function appendSessionInfoLine(filePath: string, name: string): Promise<void> {
  const line =
    JSON.stringify({
      type: 'session_info',
      id: `info-${Date.now()}`,
      parentId: null,
      timestamp: new Date().toISOString(),
      name
    }) + '\n'
  await writeFile(filePath, line, { encoding: 'utf8', flag: 'a' })
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

function walkContext(entries: SessionEntry[], leafId?: string | null): SessionContext {
  const byId = new Map(entries.map((e) => [e.id, e] as const))
  let current = leafId ?? lastEntryId(entries)
  const chain: SessionEntry[] = []
  const seen = new Set<string>()
  while (current && !seen.has(current)) {
    seen.add(current)
    const entry = byId.get(current)
    if (!entry) break
    chain.push(entry)
    current = entry.parentId
  }
  chain.reverse()
  const messages: AgentMessage[] = []
  const entryIds: string[] = []
  for (const entry of chain) {
    const message = entryToUiMessage(entry)
    if (message) {
      messages.push(message)
      entryIds.push(entry.id)
    }
  }
  return {
    messages,
    entryIds,
    entryParents: Object.fromEntries(entries.map((e) => [e.id, e.parentId])),
    thinkingLevel: 'off',
    model: null
  }
}

function entryToUiMessage(entry: SessionEntry): AgentMessage | null {
  switch (entry.type) {
    case 'message': {
      const message = entry.message as AgentMessage | undefined
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

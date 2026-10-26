/**
 * Permanent session cleanup — batch deletion of real Pi session JSONL files.
 *
 * Security invariants:
 * - Candidate files are located through SessionService-managed session ids,
 *   never through renderer-supplied paths.
 * - Every unlink is preceded by a realpath containment check against the
 *   managed sessions root, so directory traversal and symlink escapes fail.
 * - Execution requires a single-use preview token issued by a prior scan;
 *   files that changed (size or mtime) between scan and execution are skipped.
 * - Running agent sessions and (optionally) pinned sessions are protected.
 */

import { readFile, realpath, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  SessionCleanupCandidate,
  SessionCleanupPreview,
  SessionCleanupPreviewOptions,
  SessionCleanupResult,
  SessionCleanupScope
} from '@shared/ipc/api-types'
import type { SessionInfo } from '@shared/types/workspace'
import { sessionPathKey } from '@shared/workspace/session-path'
import { readSessionHeader } from './session-service'

export const SESSION_CLEANUP_PREVIEW_TTL_MS = 10 * 60_000
const MAX_PREVIEWS = 8

export interface SessionCleanupDeps {
  listSessions(force?: boolean): Promise<SessionInfo[]>
  invalidateSessions(): void
  listRunning(): string[]
  unbindSession(sessionId: string): Promise<void>
  sessionsRoot(): string
  now?: () => number
}

interface PreviewEntry {
  expiresAt: number
  scope: SessionCleanupScope
  projectKey?: string
  keepPinned: boolean
  pinnedSessionIds: string[]
  /** sessionId → captured file fingerprint at scan time. */
  candidates: Map<string, { path: string; sizeBytes: number; mtimeMs: number }>
}

const AGE_DAYS: Partial<Record<SessionCleanupScope, number>> = {
  'older-30d': 30,
  'older-90d': 90
}

export class SessionCleanupService {
  private previews = new Map<string, PreviewEntry>()
  private executing = false

  constructor(private readonly deps: SessionCleanupDeps) {}

  private clock(): number {
    return (this.deps.now ?? Date.now)()
  }

  async preview(options: SessionCleanupPreviewOptions): Promise<SessionCleanupPreview> {
    const keepPinned = options.keepPinned !== false
    const pinnedIds = keepPinned ? new Set(options.pinnedSessionIds ?? []) : new Set<string>()
    const running = new Set(this.deps.listRunning())
    const all = await this.deps.listSessions(true)
    const root = this.deps.sessionsRoot()

    const excludedRunningSet = new Set<string>()
    const excludedPinnedSet = new Set<string>()
    const excludedUnsafeSet = new Set<string>()
    const candidates: SessionCleanupCandidate[] = []
    const fingerprints = new Map<
      string,
      { path: string; sizeBytes: number; mtimeMs: number }
    >()
    let totalBytes = 0
    const projectKeys = new Set<string>()

    const minTimestamp = ageCutoff(options.scope, this.clock.bind(this))
    for (const session of all) {
      if (!matchesScope(session, options.scope, options.projectKey, minTimestamp)) continue
      if (running.has(session.id)) {
        excludedRunningSet.add(session.id)
        continue
      }
      if (pinnedIds.has(session.id)) {
        excludedPinnedSet.add(session.id)
        continue
      }
      if (session.transient || !session.path) {
        excludedUnsafeSet.add(session.id)
        continue
      }
      const info = await statSessionFile(session.path, root)
      if (!info || !info.managed) {
        excludedUnsafeSet.add(session.id)
        continue
      }
      fingerprints.set(session.id, {
        path: session.path,
        sizeBytes: info.sizeBytes,
        mtimeMs: info.mtimeMs
      })
      totalBytes += info.sizeBytes
      projectKeys.add(session.projectKey ?? session.cwd)
      candidates.push({
        sessionId: session.id,
        ...(session.name ? { name: session.name } : {}),
        ...(session.projectRoot ? { projectName: path.basename(session.projectRoot) } : {}),
        modified: session.modified,
        sizeBytes: info.sizeBytes
      })
    }

    const token = randomUUID()
    const now = this.clock()
    this.previews.set(token, {
      expiresAt: now + SESSION_CLEANUP_PREVIEW_TTL_MS,
      scope: options.scope,
      projectKey: options.projectKey,
      keepPinned,
      pinnedSessionIds: keepPinned ? [...pinnedIds] : [],
      candidates: fingerprints
    })
    this.prunePreviews(now)

    return {
      previewToken: token,
      scope: options.scope,
      candidates,
      totalBytes,
      affectedProjects: projectKeys.size,
      excludedRunning: excludedRunningSet.size,
      excludedPinned: excludedPinnedSet.size,
      excludedUnsafe: excludedUnsafeSet.size,
      expiresAt: now + SESSION_CLEANUP_PREVIEW_TTL_MS
    }
  }

  async execute(previewToken: string): Promise<SessionCleanupResult> {
    if (this.executing) throw new Error('A cleanup run is already in progress')
    const entry = this.previews.get(previewToken)
    if (!entry) throw new Error('Cleanup preview is invalid or has expired. Scan again.')
    if (this.clock() > entry.expiresAt) {
      this.previews.delete(previewToken)
      throw new Error('Cleanup preview has expired. Scan again before deleting.')
    }
    // Single use: consume the token before touching the filesystem.
    this.previews.delete(previewToken)
    this.executing = true
    try {
      return await this.run(entry)
    } finally {
      this.executing = false
    }
  }

  /** Test visibility: number of live preview tokens. */
  previewCount(): number {
    return this.previews.size
  }

  private async run(entry: PreviewEntry): Promise<SessionCleanupResult> {
    const fresh = await this.deps.listSessions(true)
    const running = new Set(this.deps.listRunning())
    const freshById = new Map(fresh.map((session) => [session.id, session]))
    const freshPathToId = new Map(
      fresh.map((session) => [sessionPathKey(session.path), session.id] as const)
    )
    const root = this.deps.sessionsRoot()
    const pinned = new Set(entry.keepPinned ? entry.pinnedSessionIds : [])

    const result: SessionCleanupResult = {
      requested: entry.candidates.size,
      deleted: 0,
      failed: 0,
      freedBytes: 0,
      skippedRunning: 0,
      skippedPinned: 0,
      skippedChanged: 0,
      skippedMissing: 0,
      deletedSessionIds: [],
      errors: []
    }

    const plan: Array<{ sessionId: string; path: string; sizeBytes: number }> = []
    for (const [sessionId, fingerprint] of entry.candidates) {
      try {
        const info = freshById.get(sessionId)
        if (!info || !info.path) {
          result.skippedMissing++
          continue
        }
        if (running.has(sessionId)) {
          result.skippedRunning++
          continue
        }
        if (pinned.has(sessionId)) {
          result.skippedPinned++
          continue
        }
        const current = await statSessionFile(info.path, root)
        if (!current || !current.managed) {
          result.errors.push({ sessionId, message: 'Session file is not a managed session file' })
          result.failed++
          continue
        }
        if (!current.exists) {
          result.skippedMissing++
          continue
        }
        if (current.sizeBytes !== fingerprint.sizeBytes || current.mtimeMs !== fingerprint.mtimeMs) {
          // The session changed after the scan (new messages, rename, …).
          result.skippedChanged++
          continue
        }
        plan.push({ sessionId, path: info.path, sizeBytes: current.sizeBytes })
      } catch (error) {
        result.errors.push({ sessionId, message: messageOf(error) })
        result.failed++
      }
    }

    const plannedIds = new Set(plan.map((item) => item.sessionId))
    await this.relinkChildren(fresh, freshPathToId, plannedIds, result)

    for (const item of plan) {
      try {
        await unlink(item.path)
        result.deleted++
        result.freedBytes += item.sizeBytes
        result.deletedSessionIds.push(item.sessionId)
      } catch (error) {
        if (isNotFound(error)) {
          result.skippedMissing++
          continue
        }
        // One failing file must not fail the whole batch.
        result.failed++
        result.errors.push({ sessionId: item.sessionId, message: messageOf(error) })
      }
    }

    if (result.deletedSessionIds.length) {
      this.deps.invalidateSessions()
      await Promise.allSettled(
        result.deletedSessionIds.map((id) => this.deps.unbindSession(id))
      )
    }
    return result
  }

  /**
   * Batch-aware fork-chain repair: children of deleted sessions are relinked
   * to the nearest surviving ancestor (or detached) in one pass, so mixed
   * parent/child batches never leave dangling or cyclic parent references.
   */
  private async relinkChildren(
    fresh: SessionInfo[],
    freshPathToId: ReadonlyMap<string, string>,
    plannedIds: ReadonlySet<string>,
    result: SessionCleanupResult
  ): Promise<void> {
    const children = fresh.filter(
      (session) =>
        session.parentSessionId !== undefined &&
        plannedIds.has(session.parentSessionId) &&
        !plannedIds.has(session.id)
    )
    for (const child of children) {
      try {
        const parent = freshByIdOf(fresh, child.parentSessionId)
        if (!parent) continue
        const ancestorPath = await this.nearestSurvivingAncestor(
          parent.path,
          freshPathToId,
          plannedIds
        )
        await rewriteParentLink(child.path, ancestorPath)
      } catch (error) {
        result.errors.push({ sessionId: child.id, message: messageOf(error) })
      }
    }
  }

  private async nearestSurvivingAncestor(
    deletedPath: string,
    freshPathToId: ReadonlyMap<string, string>,
    plannedIds: ReadonlySet<string>
  ): Promise<string | undefined> {
    let ancestorPath: string | undefined = await headerParentPath(deletedPath)
    const seen = new Set([sessionPathKey(deletedPath)])
    while (ancestorPath) {
      const key = sessionPathKey(ancestorPath)
      if (seen.has(key)) return undefined
      seen.add(key)
      const ancestorId = freshPathToId.get(key)
      if (ancestorId === undefined) return undefined
      if (!plannedIds.has(ancestorId)) return ancestorPath
      ancestorPath = await headerParentPath(ancestorPath)
    }
    return undefined
  }

  private prunePreviews(now: number): void {
    for (const [token, entry] of this.previews) {
      if (now > entry.expiresAt) this.previews.delete(token)
    }
    while (this.previews.size > MAX_PREVIEWS) {
      const oldest = [...this.previews.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0]
      this.previews.delete(oldest[0])
    }
  }
}

function freshByIdOf(sessions: SessionInfo[], id: string | undefined): SessionInfo | undefined {
  if (id === undefined) return undefined
  return sessions.find((session) => session.id === id)
}

function ageCutoff(scope: SessionCleanupScope, now: () => number): number | undefined {
  const days = AGE_DAYS[scope]
  return days === undefined ? undefined : now() - days * 24 * 60 * 60_000
}

function matchesScope(
  session: SessionInfo,
  scope: SessionCleanupScope,
  projectKey: string | undefined,
  minTimestamp: number | undefined
): boolean {
  switch (scope) {
    case 'current-project':
      return Boolean(projectKey) && session.projectKey === projectKey
    case 'older-30d':
    case 'older-90d': {
      const modified = Date.parse(session.modified)
      return Number.isFinite(modified) && minTimestamp !== undefined && modified < minTimestamp
    }
    case 'all':
      return true
    default:
      return false
  }
}

interface SessionFileStat {
  exists: boolean
  managed: boolean
  sizeBytes: number
  mtimeMs: number
}

/**
 * Verify the file is a real, non-symlink JSONL file inside the managed
 * sessions root before it may be deleted. Symlinks are resolved with
 * realpath on both sides; any escape from the root fails the check.
 */
async function statSessionFile(filePath: string, root: string): Promise<SessionFileStat> {
  try {
    const info = await stat(filePath)
    if (!info.isFile() || !filePath.toLowerCase().endsWith('.jsonl')) {
      return { exists: true, managed: false, sizeBytes: 0, mtimeMs: 0 }
    }
    const managed = await isInsideSessionsRoot(filePath, root)
    return {
      exists: true,
      managed,
      sizeBytes: info.size,
      mtimeMs: info.mtimeMs
    }
  } catch (error) {
    if (isNotFound(error)) return { exists: false, managed: false, sizeBytes: 0, mtimeMs: 0 }
    return { exists: true, managed: false, sizeBytes: 0, mtimeMs: 0 }
  }
}

async function isInsideSessionsRoot(filePath: string, root: string): Promise<boolean> {
  try {
    const [realRoot, realFile] = await Promise.all([realpath(root), realpath(filePath)])
    const rel = path.relative(realRoot, realFile)
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
  } catch {
    return false
  }
}

async function headerParentPath(filePath: string): Promise<string | undefined> {
  try {
    const header = await readSessionHeader(filePath)
    return header?.parentSession
  } catch {
    return undefined
  }
}

/** Rewrite the child session header's parentSession link (or remove it). */
async function rewriteParentLink(childPath: string, parentPath: string | undefined): Promise<void> {
  const content = await readFile(childPath, 'utf8')
  const lines = content.split('\n')
  const header = JSON.parse(lines[0] ?? '{}') as { type?: string; parentSession?: string }
  if (header.type !== 'session') return
  if (parentPath === undefined) delete header.parentSession
  else header.parentSession = parentPath
  lines[0] = JSON.stringify(header)
  await writeFile(childPath, lines.join('\n'))
}

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

import { afterAll, beforeAll, describe, expect, it, vi, type Mock } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { SessionCleanupService, SESSION_CLEANUP_PREVIEW_TTL_MS } from './session-cleanup-service'
import type { SessionInfo } from '@shared/types/workspace'
import type { SessionCleanupDeps } from './session-cleanup-service'

const NOW = Date.parse('2026-06-01T00:00:00.000Z')
const OLD_MODIFIED = '2026-01-01T00:00:00.000Z' // 151 days before NOW
const RECENT_MODIFIED = '2026-05-28T00:00:00.000Z' // 4 days before NOW

let root: string

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pi-harness-cleanup-')))
})

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

function writeSessionFile(
  id: string,
  options: { parentPath?: string; body?: string } = {}
): string {
  const file = path.join(root, `${id}.jsonl`)
  const header: Record<string, unknown> = {
    type: 'session',
    version: 3,
    id,
    timestamp: OLD_MODIFIED,
    cwd: root
  }
  if (options.parentPath) header.parentSession = options.parentPath
  const lines = [JSON.stringify(header)]
  if (options.body) lines.push(options.body)
  fs.writeFileSync(file, lines.join('\n') + '\n')
  return file
}

function info(
  id: string,
  overrides: Partial<SessionInfo> = {}
): SessionInfo {
  return {
    path: path.join(root, `${id}.jsonl`),
    id,
    cwd: root,
    created: OLD_MODIFIED,
    modified: OLD_MODIFIED,
    messageCount: 1,
    firstMessage: 'hello',
    projectKey: 'project-a',
    projectRoot: '/tmp/project-a',
    ...overrides
  }
}

interface Harness {
  service: SessionCleanupService
  sessions: SessionInfo[]
  running: Set<string>
  invalidated: Mock<() => void>
  unbound: string[]
}

function makeService(initial: SessionInfo[]): Harness {
  const harness: Harness = {
    sessions: initial,
    running: new Set<string>(),
    invalidated: vi.fn(),
    unbound: [],
    service: undefined as unknown as SessionCleanupService
  }
  const deps: SessionCleanupDeps = {
    listSessions: vi.fn(async () => [...harness.sessions]),
    invalidateSessions: () => harness.invalidated(),
    listRunning: () => [...harness.running],
    unbindSession: async (id: string) => {
      harness.unbound.push(id)
    },
    sessionsRoot: () => root,
    now: () => NOW
  }
  harness.service = new SessionCleanupService(deps)
  return harness
}

describe('SessionCleanupService preview', () => {
  it('returns an empty preview when there are no sessions', async () => {
    const harness = makeService([])
    const preview = await harness.service.preview({ scope: 'all' })
    expect(preview.candidates).toEqual([])
    expect(preview.totalBytes).toBe(0)
    expect(preview.affectedProjects).toBe(0)
    expect(preview.excludedRunning).toBe(0)
    expect(preview.previewToken).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('measures real on-disk file sizes instead of estimating', async () => {
    const file = writeSessionFile('s1', { body: 'x'.repeat(1000) })
    const harness = makeService([info('s1')])
    const preview = await harness.service.preview({ scope: 'all' })
    expect(preview.candidates).toHaveLength(1)
    expect(preview.candidates[0].sizeBytes).toBe(fs.statSync(file).size)
    expect(preview.totalBytes).toBe(fs.statSync(file).size)
    void file
  })

  it('filters by project key', async () => {
    writeSessionFile('a')
    writeSessionFile('b')
    const harness = makeService([
      info('a', { projectKey: 'project-a' }),
      info('b', { projectKey: 'project-b' })
    ])
    const preview = await harness.service.preview({
      scope: 'current-project',
      projectKey: 'project-b'
    })
    expect(preview.candidates.map((c) => c.sessionId)).toEqual(['b'])
  })

  it('filters by inactivity window using last activity time', async () => {
    writeSessionFile('old')
    writeSessionFile('recent')
    const harness = makeService([
      info('old', { modified: OLD_MODIFIED }),
      info('recent', { modified: RECENT_MODIFIED })
    ])
    const p30 = await harness.service.preview({ scope: 'older-30d' })
    expect(p30.candidates.map((c) => c.sessionId)).toEqual(['old'])
    const p90 = await harness.service.preview({ scope: 'older-90d' })
    expect(p90.candidates.map((c) => c.sessionId)).toEqual(['old'])
  })

  it('protects running and pinned sessions and reports the exclusions', async () => {
    writeSessionFile('a')
    writeSessionFile('b')
    writeSessionFile('c')
    const harness = makeService([info('a'), info('b'), info('c')])
    harness.running.add('b')
    const preview = await harness.service.preview({
      scope: 'all',
      keepPinned: true,
      pinnedSessionIds: ['c']
    })
    expect(preview.candidates.map((c) => c.sessionId)).toEqual(['a'])
    expect(preview.excludedRunning).toBe(1)
    expect(preview.excludedPinned).toBe(1)
  })

  it('excludes symlink escapes and non-jsonl targets from candidates', async () => {
    const outside = path.join(root, '..', 'pi-harness-cleanup-outside.jsonl')
    fs.writeFileSync(outside, '{"type":"session"}\n')
    const link = path.join(root, 'evil.jsonl')
    fs.symlinkSync(outside, link)
    try {
      const harness = makeService([info('evil', { path: link })])
      const preview = await harness.service.preview({ scope: 'all' })
      expect(preview.candidates).toEqual([])
      expect(preview.excludedUnsafe).toBe(1)
    } finally {
      fs.rmSync(link)
      fs.rmSync(outside)
    }
  })
})

describe('SessionCleanupService execute', () => {
  it('deletes a single session file and reports real freed bytes', async () => {
    const file = writeSessionFile('solo', { body: 'y'.repeat(500) })
    const expectedSize = fs.statSync(file).size
    const harness = makeService([info('solo')])
    const preview = await harness.service.preview({ scope: 'all' })
    const result = await harness.service.execute(preview.previewToken)
    expect(fs.existsSync(file)).toBe(false)
    expect(result).toMatchObject({
      requested: 1,
      deleted: 1,
      failed: 0,
      freedBytes: expectedSize,
      skippedMissing: 0
    })
    expect(result.deletedSessionIds).toEqual(['solo'])
    expect(result.errors).toEqual([])
    expect(harness.invalidated).toHaveBeenCalledTimes(1)
    expect(harness.unbound).toEqual(['solo'])
  })

  it('deletes multiple sessions in one batch', async () => {
    const files = ['m1', 'm2', 'm3'].map((id) => writeSessionFile(id))
    const harness = makeService(files.map((file, i) => info(`m${i + 1}`)))
    const preview = await harness.service.preview({ scope: 'all' })
    const result = await harness.service.execute(preview.previewToken)
    expect(result.deleted).toBe(3)
    expect(result.failed).toBe(0)
    expect(files.map((file) => fs.existsSync(file))).toEqual([false, false, false])
  })

  it('is a no-op with an invalid or consumed token', async () => {
    writeSessionFile('t1')
    const harness = makeService([info('t1')])
    await expect(harness.service.execute('not-a-token')).rejects.toThrow(/invalid|expired/i)
    const preview = await harness.service.preview({ scope: 'all' })
    const first = await harness.service.execute(preview.previewToken)
    expect(first.deleted).toBe(1)
    await expect(harness.service.execute(preview.previewToken)).rejects.toThrow(/invalid|expired/i)
  })

  it('expires a preview after the TTL so stale scans cannot delete', async () => {
    writeSessionFile('stale')
    let currentTime = NOW
    const service = new SessionCleanupService({
      listSessions: async () => [info('stale')],
      invalidateSessions: () => undefined,
      listRunning: () => [],
      unbindSession: async () => undefined,
      sessionsRoot: () => root,
      now: () => currentTime
    })
    const preview = await service.preview({ scope: 'all' })
    currentTime += SESSION_CLEANUP_PREVIEW_TTL_MS + 1
    await expect(service.execute(preview.previewToken)).rejects.toThrow(/expired/i)
    expect(fs.existsSync(path.join(root, 'stale.jsonl'))).toBe(true)
  })

  it('rejects a second execution while one is in progress', async () => {
    writeSessionFile('c1')
    writeSessionFile('c2')
    const harness = makeService([info('c1'), info('c2')])
    const previewA = await harness.service.preview({ scope: 'all' })
    const previewB = await harness.service.preview({ scope: 'all' })
    // Keep the first execution in-flight on its fresh list scan.
    let release!: (sessions: SessionInfo[]) => void
    const pending = new Promise<SessionInfo[]>((resolve) => (release = resolve))
    const deps = (
      harness.service as unknown as {
        deps: SessionCleanupDeps & { listSessions: ReturnType<typeof vi.fn> }
      }
    ).deps
    deps.listSessions.mockImplementation(async () => {
      if (deps.listSessions.mock.calls.length <= 2) return [...harness.sessions]
      return pending
    })
    const inFlight = harness.service.execute(previewA.previewToken)
    await expect(harness.service.execute(previewB.previewToken)).rejects.toThrow(
      /already in progress/i
    )
    release([info('c1'), info('c2')])
    const result = await inFlight
    expect(result.deleted).toBe(2)
  })

  it('skips sessions that are running at execution time', async () => {
    const file = writeSessionFile('runner')
    const harness = makeService([info('runner')])
    const preview = await harness.service.preview({ scope: 'all' })
    harness.running.add('runner')
    const result = await harness.service.execute(preview.previewToken)
    expect(result.deleted).toBe(0)
    expect(result.skippedRunning).toBe(1)
    expect(fs.existsSync(file)).toBe(true)
  })

  it('keeps pinned sessions out of the deletion plan end to end', async () => {
    const file = writeSessionFile('pin')
    const harness = makeService([info('pin')])
    const preview = await harness.service.preview({
      scope: 'all',
      keepPinned: true,
      pinnedSessionIds: ['pin']
    })
    expect(preview.candidates).toHaveLength(0)
    const result = await harness.service.execute(preview.previewToken)
    expect(result.requested).toBe(0)
    expect(result.deleted).toBe(0)
    expect(fs.existsSync(file)).toBe(true)
  })

  it('does not delete sessions created or changed between scan and execution', async () => {
    const file = writeSessionFile('changed')
    const harness = makeService([info('changed')])
    const preview = await harness.service.preview({ scope: 'all' })
    fs.appendFileSync(file, '{"type":"message"}\n')
    const result = await harness.service.execute(preview.previewToken)
    expect(result.deleted).toBe(0)
    expect(result.skippedChanged).toBe(1)
    expect(fs.existsSync(file)).toBe(true)
  })

  it('does not delete newly appeared sessions that were absent from the scan', async () => {
    writeSessionFile('existing')
    const harness = makeService([info('existing')])
    const preview = await harness.service.preview({ scope: 'all' })
    // A brand new session shows up after the scan; it is not in the token.
    const newFile = writeSessionFile('brand-new')
    harness.sessions.push(info('brand-new'))
    const result = await harness.service.execute(preview.previewToken)
    expect(result.deletedSessionIds).toEqual(['existing'])
    expect(fs.existsSync(newFile)).toBe(true)
  })

  it('reports missing files as skipped instead of failing the batch', async () => {
    writeSessionFile('gone')
    const harness = makeService([info('gone')])
    const preview = await harness.service.preview({ scope: 'all' })
    // File disappeared between scan and execution.
    harness.sessions = []
    const result = await harness.service.execute(preview.previewToken)
    expect(result.deleted).toBe(0)
    expect(result.skippedMissing).toBe(1)
  })

  it('reports a per-file failure without failing the other deletions', async () => {
    writeSessionFile('ok')
    const broken = writeSessionFile('broken')
    // Replace the file with a directory after the scan fingerprint is taken:
    // execution must fail for that session only.
    const harness = makeService([info('ok'), info('broken')])
    const preview = await harness.service.preview({ scope: 'all' })
    fs.rmSync(broken)
    fs.mkdirSync(broken)
    const result = await harness.service.execute(preview.previewToken)
    expect(result.deleted).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.deletedSessionIds).toEqual(['ok'])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].sessionId).toBe('broken')
    expect(fs.existsSync(broken)).toBe(true)
  })

  it('refuses to delete files outside the managed sessions root', async () => {
    const outsideDir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'pi-harness-cleanup-out-'))
    )
    try {
      const outsideFile = path.join(outsideDir, 'outside.jsonl')
      fs.writeFileSync(outsideFile, '{"type":"session"}\n')
      const harness = makeService([info('outside', { path: outsideFile })])
      const preview = await harness.service.preview({ scope: 'all' })
      expect(preview.candidates).toEqual([])
      const result = await harness.service.execute(preview.previewToken)
      expect(result.deleted).toBe(0)
      expect(fs.existsSync(outsideFile)).toBe(true)
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true })
    }
  })

  it('relinks surviving children to the nearest surviving ancestor', async () => {
    const grandparent = writeSessionFile('g')
    const parent = writeSessionFile('p', { parentPath: grandparent })
    const child = writeSessionFile('c', { parentPath: parent })
    // Only the parent is old enough to sweep; grandparent and pinned child stay.
    const harness = makeService([
      info('g', { modified: RECENT_MODIFIED }),
      info('p'),
      info('c', { parentSessionId: 'p' })
    ])
    const preview = await harness.service.preview({
      scope: 'older-30d',
      keepPinned: true,
      pinnedSessionIds: ['c']
    })
    expect(preview.candidates.map((c) => c.sessionId)).toEqual(['p'])
    const result = await harness.service.execute(preview.previewToken)
    expect(result.deleted).toBe(1)
    const childHeader = JSON.parse(fs.readFileSync(child, 'utf8').split('\n')[0]) as {
      parentSession?: string
    }
    expect(childHeader.parentSession).toBe(grandparent)
    expect(fs.existsSync(child)).toBe(true)
    expect(fs.existsSync(parent)).toBe(false)
  })

  it('detaches surviving children when the whole fork chain is deleted', async () => {
    const parent = writeSessionFile('fp')
    const child = writeSessionFile('fc', { parentPath: parent })
    const harness = makeService([info('fp'), info('fc', { parentSessionId: 'fp' })])
    const preview = await harness.service.preview({ scope: 'all' })
    const result = await harness.service.execute(preview.previewToken)
    expect(result.deleted).toBe(2)
    expect(fs.existsSync(child)).toBe(false)
    expect(fs.existsSync(parent)).toBe(false)
  })

  it('leaves transient sessions out of any deletion plan', async () => {
    const harness = makeService([info('ghost', { transient: true })])
    const preview = await harness.service.preview({ scope: 'all' })
    expect(preview.candidates).toEqual([])
  })
})

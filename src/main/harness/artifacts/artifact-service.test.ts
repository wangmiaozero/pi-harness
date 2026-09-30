import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HarnessEvent, HarnessRun } from '@shared/types/harness'
import type { SessionEntry } from '@shared/types/workspace'
import { JsonStore } from '../../services/storage'
import { ArtifactService, EMPTY_ARTIFACT_STORE, type ArtifactStoreRecord } from './artifact-service'

const tempDirs: string[] = []
const emitted: HarnessEvent[] = []

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
  emitted.length = 0
})

function tempStore(): JsonStore<ArtifactStoreRecord> {
  const dir = mkdtempSync(path.join(tmpdir(), 'pi-harness-test-'))
  tempDirs.push(dir)
  return new JsonStore(path.join(dir, 'artifacts.json'), EMPTY_ARTIFACT_STORE)
}

function run(overrides: Partial<HarnessRun> = {}): HarnessRun {
  return {
    id: 'h:entry-1',
    sessionId: 's1',
    parentRunId: null,
    relation: 'original',
    forkedFromRunId: null,
    forkedFromEventId: null,
    forkedFromCheckpointId: null,
    status: 'success',
    source: 'live',
    anchorEntryId: 'entry-1',
    cwd: '/repo',
    startedAt: Date.parse('2024-01-01T00:00:00.000Z'),
    finishedAt: Date.parse('2024-01-01T00:00:10.000Z'),
    model: 'model-a',
    provider: null,
    prompt: 'ship it',
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      totalTokens: 0,
      estimatedCost: null
    },
    toolCallCount: 0,
    toolFailureCount: 0,
    contextUsage: null,
    result: null,
    error: null,
    agentId: null,
    taskId: null,
    orchestrationId: null,
    budgetExceeded: null,
    steps: [],
    checkpointIds: [],
    ...overrides
  }
}

function userEntry(timestamp: string, text: string): SessionEntry {
  return {
    type: 'message',
    id: 'entry-1',
    parentId: null,
    timestamp,
    message: { role: 'user', content: text }
  } as unknown as SessionEntry
}

function writeEntry(id: string, timestamp: string, filePath: string): SessionEntry {
  return {
    type: 'message',
    id,
    parentId: 'entry-1',
    timestamp,
    message: {
      role: 'assistant',
      content: [
        { type: 'toolCall', toolCallId: `${id}-tc`, toolName: 'write', input: { path: filePath } }
      ]
    }
  } as unknown as SessionEntry
}

function nativeWriteEntry(id: string, timestamp: string, filePath: string): SessionEntry {
  return {
    type: 'message',
    id,
    parentId: 'entry-1',
    timestamp,
    message: {
      role: 'assistant',
      content: [
        {
          type: 'toolCall',
          id: `${id}-tc`,
          name: 'write',
          arguments: { path: filePath, content: '<!doctype html>' }
        }
      ]
    }
  } as unknown as SessionEntry
}

function bashEntry(id: string, timestamp: string, command: string, exitCode: number): SessionEntry {
  return {
    type: 'message',
    id,
    parentId: 'entry-1',
    timestamp,
    message: { role: 'bashExecution', command, output: '', exitCode }
  } as unknown as SessionEntry
}

function service(entries: SessionEntry[], options: { cwd?: string | null } = {}): ArtifactService {
  const target = run({ cwd: options.cwd ?? null })
  return new ArtifactService(tempStore(), {
    getEntries: vi.fn(async () => entries),
    getCheckpoints: vi.fn(async () => []),
    getGitCommits: vi.fn(async () => [
      { hash: 'a1b2c3d', subject: 'ship the feature', timestamp: target.startedAt + 1_000 }
    ]),
    getFileDiff: vi.fn(async () => ({
      supported: true,
      status: 'modified' as const,
      patch: '--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1,2 @@\n-old\n+new\n+next\n'
    })),
    emit: (_sessionId, event) => {
      emitted.push(event)
    }
  })
}

describe('ArtifactService.collectForRun', () => {
  it('collects file, command and git-commit artifacts from real evidence', async () => {
    const entries = [
      userEntry('2024-01-01T00:00:00.000Z', 'ship it'),
      writeEntry('entry-2', '2024-01-01T00:00:02.000Z', '/repo/src/app.ts'),
      bashEntry('entry-3', '2024-01-01T00:00:04.000Z', 'pnpm test', 0),
      bashEntry('entry-4', '2024-01-01T00:00:06.000Z', 'pnpm build', 1),
      bashEntry('entry-5', '2024-01-01T00:00:08.000Z', 'git log --oneline -5', 0)
    ]
    const artifacts = await service(entries, { cwd: '/repo' }).collectForRun(run({ cwd: '/repo' }))

    const types = artifacts.map((artifact) => artifact.type).sort()
    expect(types).toEqual(['build-output', 'file', 'git-commit', 'log', 'test-report'])
    const file = artifacts.find((artifact) => artifact.type === 'file')
    expect(file).toMatchObject({ name: 'app.ts', path: '/repo/src/app.ts' })
    expect(file?.metadata).toMatchObject({
      resolvedPath: '/repo/src/app.ts',
      additions: 2,
      deletions: 1,
      patchTruncated: false
    })
    expect(file?.metadata.patch).toContain('+next')
    const failedBuild = artifacts.find((artifact) => artifact.type === 'build-output')
    expect(failedBuild?.metadata).toMatchObject({ exitCode: 1, failed: true })
    const commit = artifacts.find((artifact) => artifact.type === 'git-commit')
    expect(commit?.name).toBe('ship the feature')
    const shellLog = artifacts.find((artifact) => artifact.type === 'log')
    expect(shellLog?.metadata).toMatchObject({ command: 'git log --oneline -5', failed: false })

    // Every artifact emits a derived event so the timeline stays live.
    expect(emitted.filter((event) => event.type === 'artifact.recorded')).toHaveLength(
      artifacts.length
    )
  })

  it('skips git commits when the run has no project cwd', async () => {
    const entries = [
      userEntry('2024-01-01T00:00:00.000Z', 'ship it'),
      writeEntry('entry-2', '2024-01-01T00:00:02.000Z', '/repo/src/app.ts')
    ]
    const artifacts = await service(entries, { cwd: null }).collectForRun(run({ cwd: null }))
    expect(artifacts.map((artifact) => artifact.type)).toEqual(['file'])
  })

  it('resolves relative mutation paths against the run cwd for diff previews', async () => {
    const entries = [
      userEntry('2024-01-01T00:00:00.000Z', 'ship it'),
      writeEntry('entry-2', '2024-01-01T00:00:02.000Z', 'src/app.ts')
    ]
    const artifactService = service(entries, { cwd: '/repo' })
    const artifacts = await artifactService.collectForRun(run({ cwd: '/repo' }))

    expect(artifacts[0]).toMatchObject({
      path: 'src/app.ts',
      metadata: { resolvedPath: '/repo/src/app.ts' }
    })
  })

  it('collects native Pi name/arguments tool calls and backfills them once', async () => {
    const entries = [
      userEntry('2024-01-01T00:00:00.000Z', 'create a page'),
      nativeWriteEntry('entry-2', '2024-01-01T00:00:02.000Z', '/repo/pelican-bicycle.html')
    ]
    const artifactService = service(entries, { cwd: '/repo' })
    const targetRun = run({ cwd: '/repo' })

    const first = await artifactService.ensureFileArtifactsForRun(targetRun)
    const second = await artifactService.ensureFileArtifactsForRun(targetRun)

    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({
      type: 'file',
      name: 'pelican-bicycle.html',
      path: '/repo/pelican-bicycle.html',
      createdAt: Date.parse('2024-01-01T00:00:02.000Z')
    })
    expect(second).toEqual(first)
    expect(await artifactService.list('s1', targetRun.id)).toHaveLength(1)
    expect(emitted.filter((event) => event.type === 'artifact.recorded')).toHaveLength(1)
  })

  it('creates a preview patch from native write content outside a git repository', async () => {
    const entries = [
      userEntry('2024-01-01T00:00:00.000Z', 'create a page'),
      nativeWriteEntry('entry-2', '2024-01-01T00:00:02.000Z', '/repo/page.html')
    ]
    const artifactService = new ArtifactService(tempStore(), {
      getEntries: vi.fn(async () => entries),
      getCheckpoints: vi.fn(async () => []),
      getGitCommits: vi.fn(async () => []),
      getFileDiff: vi.fn(async () => ({ supported: false as const })),
      emit: () => undefined
    })

    const artifacts = await artifactService.collectForRun(run({ cwd: '/repo' }))

    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]?.metadata).toMatchObject({
      additions: 1,
      deletions: 0,
      patchSource: 'tool-write-snapshot',
      patchTruncated: false
    })
    expect(artifacts[0]?.metadata.patch).toContain('+<!doctype html>')
  })

  it('returns nothing and swallows hook failures', async () => {
    const failing = new ArtifactService(tempStore(), {
      getEntries: vi.fn(async () => {
        throw new Error('session store unavailable')
      }),
      getCheckpoints: vi.fn(async () => []),
      getGitCommits: vi.fn(async () => []),
      emit: () => undefined
    })
    expect(await failing.collectForRun(run())).toEqual([])
    expect(emitted).toEqual([])
  })

  it('persists artifacts and lists them by session and run', async () => {
    const artifactService = service([
      userEntry('2024-01-01T00:00:00.000Z', 'ship it'),
      writeEntry('entry-2', '2024-01-01T00:00:02.000Z', '/repo/src/app.ts')
    ])
    const collected = await artifactService.collectForRun(run({ cwd: null }))
    expect(collected).toHaveLength(1)

    const bySession = await artifactService.list('s1')
    expect(bySession).toHaveLength(1)
    const byRun = await artifactService.list('s1', 'h:entry-1')
    expect(byRun.map((artifact) => artifact.type)).toEqual(['file'])
    expect(await artifactService.list('s1', 'h:other')).toEqual([])
    expect(await artifactService.listByRunIds(['h:entry-1'])).toHaveLength(1)
  })
})

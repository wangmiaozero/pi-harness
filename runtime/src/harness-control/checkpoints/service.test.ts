import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HarnessEvent } from '../types.js'
import { JsonStore } from '../../support/json-store.js'
import {
  CheckpointService,
  EMPTY_CHECKPOINT_STORE,
  type CheckpointHooks,
  type CheckpointStoreRecord
} from './service.js'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function createStore(): JsonStore<CheckpointStoreRecord> {
  const dir = mkdtempSync(path.join(tmpdir(), 'pi-harness-cp-'))
  tempDirs.push(dir)
  return new JsonStore(path.join(dir, 'checkpoints.json'), EMPTY_CHECKPOINT_STORE)
}

function createHooks(overrides: Partial<CheckpointHooks> = {}): {
  hooks: CheckpointHooks
  emit: ReturnType<typeof vi.fn>
} {
  const hooks: CheckpointHooks = {
    getSessionState: vi.fn(async () => ({
      cwd: '/tmp/project',
      leafId: 'entry-1'
    })),
    getGitState: vi.fn(async () => ({
      commit: 'abc123',
      branch: 'main',
      dirty: { modified: 2, added: 1, deleted: 0 }
    })),
    getContextState: vi.fn(async () => ({ percent: 42, tokens: 8000 })),
    navigateTree: vi.fn(async () => undefined),
    fork: vi.fn(async () => ({ cancelled: false, newSessionId: 'session-forked' })),
    prompt: vi.fn(async () => undefined),
    getLastRetryablePrompt: vi.fn(async () => null),
    emit: vi.fn(),
    attachToRun: vi.fn(),
    ...overrides
  }
  return { hooks, emit: hooks.emit as unknown as ReturnType<typeof vi.fn> }
}

describe('CheckpointService', () => {
  it('creates checkpoints with git state and anchors them to the session leaf', async () => {
    const store = createStore()
    const { hooks, emit } = createHooks()
    const service = new CheckpointService(store, hooks)

    const checkpoint = await service.create('s1', { reason: 'manual', includeGit: true })

    expect(checkpoint).toMatchObject({
      sessionId: 's1',
      reason: 'manual',
      kind: 'session',
      sessionEntryId: 'entry-1',
      gitCommit: 'abc123',
      gitBranch: 'main',
      contextState: { percent: 42, tokens: 8000 }
    })
    expect(emit).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ type: 'checkpoint.created', checkpointId: checkpoint.id })
    )
    expect(await service.list('s1')).toHaveLength(1)
    // Persisted: a fresh service over the same store sees it too.
    expect(await new CheckpointService(store, createHooks().hooks).list('s1')).toHaveLength(1)
  })

  it('downgrades the checkpoint kind when anchors are unavailable', async () => {
    const { hooks } = createHooks({
      getSessionState: vi.fn(async () => ({ cwd: '/tmp/project', leafId: null })),
      getGitState: vi.fn(async () => null)
    })
    const service = new CheckpointService(createStore(), hooks)
    const checkpoint = await service.create('s1', { reason: 'manual', includeGit: true })
    expect(checkpoint.kind).toBe('logical')
    expect(checkpoint.gitCommit).toBeNull()
  })

  it('falls back to a git checkpoint when no session anchor exists', async () => {
    const { hooks } = createHooks({
      getSessionState: vi.fn(async () => ({ cwd: '/tmp/project', leafId: null }))
    })
    const service = new CheckpointService(createStore(), hooks)
    const checkpoint = await service.create('s1', { reason: 'manual', includeGit: true })
    expect(checkpoint).toMatchObject({ kind: 'git', gitCommit: 'abc123' })
  })

  it('resumes a checkpoint by navigating the session tree and optionally prompting', async () => {
    const { hooks, emit } = createHooks()
    const service = new CheckpointService(createStore(), hooks)
    const checkpoint = await service.create('s1', { reason: 'manual' })

    const result = await service.resume(checkpoint.id, 'continue from here')

    expect(result).toEqual({ resumed: true, prompted: true })
    expect(hooks.navigateTree).toHaveBeenCalledWith('s1', 'entry-1')
    expect(hooks.prompt).toHaveBeenCalledWith('s1', 'continue from here')
    expect(emit).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ type: 'recovery.started', kind: 'resume' })
    )
    expect(emit).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ type: 'recovery.completed', kind: 'resume' })
    )
  })

  it('forks a checkpoint into a new session', async () => {
    const { hooks } = createHooks()
    const service = new CheckpointService(createStore(), hooks)
    const checkpoint = await service.create('s1', { reason: 'manual' })

    const result = await service.fork(checkpoint.id)

    expect(result).toEqual({ cancelled: false, newSessionId: 'session-forked' })
    expect(hooks.fork).toHaveBeenCalledWith('s1', 'entry-1')
  })

  it('rejects resume and fork for unknown checkpoints', async () => {
    const service = new CheckpointService(createStore(), createHooks().hooks)
    await expect(service.resume('missing')).rejects.toMatchObject({ code: 'CHECKPOINT_NOT_FOUND' })
    await expect(service.fork('missing')).rejects.toMatchObject({ code: 'CHECKPOINT_NOT_FOUND' })
  })

  it('retries the last failed run by replaying its prompt', async () => {
    const { hooks, emit } = createHooks({
      getLastRetryablePrompt: vi.fn(async () => 'run the tests again')
    })
    const service = new CheckpointService(createStore(), hooks)

    const result = await service.retryLastRun('s1')

    expect(result).toEqual({ retried: true, prompt: 'run the tests again' })
    expect(hooks.getLastRetryablePrompt).toHaveBeenCalledWith('s1')
    expect(hooks.prompt).toHaveBeenCalledWith('s1', 'run the tests again')
    const events = emit.mock.calls.map((call) => (call[1] as HarnessEvent).type)
    expect(events).toContain('recovery.started')
  })

  it('reports nothing to retry when no failed run exists', async () => {
    const service = new CheckpointService(createStore(), createHooks().hooks)
    expect(await service.retryLastRun('s1')).toEqual({ retried: false, prompt: null })
  })

  it('prunes checkpoints per session and in total', async () => {
    const store = createStore()
    const { hooks } = createHooks({
      getSessionState: vi.fn(async () => ({ cwd: '/tmp/project', leafId: `entry-${Date.now()}` }))
    })
    const service = new CheckpointService(store, hooks)

    for (let index = 0; index < 120; index += 1) {
      await service.create('s1', { reason: 'manual' })
    }
    expect(await service.list('s1')).toHaveLength(100)
    expect((await store.read()).checkpoints).toHaveLength(100)
  })
})

import { describe, expect, it, vi } from 'vitest'
import type { JsonStore } from '../services/storage'
import type { AppSettings } from '@shared/ipc/api-types'
import type { WorktreeService } from '../git/worktree-service'
import type { FileAccessService } from '../files/file-access-service'
import { computeSessionTotalActiveMs, entryToUiMessage, SessionService } from './session-service'
import type { PiSessionInfoLike } from '../agent/pi-sdk'
import type { SessionIndex } from './session-index-client'
import * as piSdk from '../agent/pi-sdk'

function session(id: string): PiSessionInfoLike {
  return {
    id,
    path: `/tmp/pi-harness-index-test/${id}.jsonl`,
    cwd: '/tmp/pi-harness-index-test',
    created: new Date('2026-10-13T00:00:00.000Z'),
    modified: new Date('2026-10-13T01:00:00.000Z'),
    messageCount: 2,
    firstMessage: 'Native preview',
    name: 'Native name'
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => (resolve = done))
  return { promise, resolve }
}

function indexedService(index: SessionIndex) {
  const worktrees = {
    resolveProject: vi.fn(async (cwd: string) => ({
      projectRoot: cwd,
      branch: null,
      isWorktree: false
    }))
  } as unknown as WorktreeService
  return new SessionService(
    {} as JsonStore<AppSettings>,
    worktrees,
    { invalidate: vi.fn() } as unknown as FileAccessService,
    index
  )
}

describe('SessionService background list', () => {
  it('coalesces concurrent reads and retains Native metadata and branch links', async () => {
    const scan = deferred<PiSessionInfoLike[]>()
    const index = { list: vi.fn(() => scan.promise), close: vi.fn() }
    const service = indexedService(index)
    const first = service.list()
    const second = service.list()
    const parent = session('parent')
    const child = { ...session('child'), parentSessionPath: parent.path }
    scan.resolve([child, parent])
    const data = await first
    expect(await second).toEqual(data)
    expect(index.list).toHaveBeenCalledTimes(1)
    expect(data[0]).toMatchObject({
      id: 'child',
      parentSessionId: 'parent',
      name: 'Native name',
      created: '2026-10-13T00:00:00.000Z',
      modified: '2026-10-13T01:00:00.000Z',
      messageCount: 2,
      firstMessage: 'Native preview',
      projectRoot: child.cwd,
      transient: false
    })
    expect(await service.resolveIdByPath(parent.path)).toBe('parent')
    await service.list()
    expect(index.list).toHaveBeenCalledTimes(1)
  })

  it('does not publish a stale scan or clear the newer pending request', async () => {
    const old = deferred<PiSessionInfoLike[]>()
    const current = deferred<PiSessionInfoLike[]>()
    const index = {
      list: vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise),
      close: vi.fn()
    }
    const service = indexedService(index)
    const first = service.list()
    const refresh = service.list(true)
    old.resolve([session('removed')])
    // Let the old scan finish while the new one is still running.
    await vi.waitFor(() => expect(index.list).toHaveBeenCalledTimes(2))
    const concurrent = service.list()
    current.resolve([session('current')])
    for (const result of await Promise.all([first, refresh, concurrent])) {
      expect(result.map((item) => item.id)).toEqual(['current'])
    }
    expect(await service.resolveIdByPath(session('removed').path)).toBeUndefined()
    expect(await service.resolveIdByPath(session('current').path)).toBe('current')
    expect(index.list).toHaveBeenCalledTimes(2)
  })

  it('closes its index without starting fallback readers during shutdown', async () => {
    const scan = deferred<PiSessionInfoLike[]>()
    const index = { list: vi.fn(() => scan.promise), close: vi.fn() }
    const service = indexedService(index)
    const pending = expect(service.list()).rejects.toThrow('closed')
    await service.close()
    scan.resolve([session('old')])
    await pending
    await expect(service.list()).rejects.toThrow('closed')
    expect(index.close).toHaveBeenCalledTimes(1)
  })

  it('keeps the existing Native reader when a worker cannot start', async () => {
    const listAll = vi.fn().mockResolvedValue([session('fallback')])
    const sdk = vi.spyOn(piSdk, 'loadPiCodingAgent').mockResolvedValue({
      SessionManager: { listAll }
    } as unknown as piSdk.PiCodingAgentModule)
    try {
      const service = indexedService({
        list: vi.fn().mockRejectedValue(new Error('Worker unavailable')),
        close: vi.fn()
      })
      const data = await service.list()
      expect(data[0]).toMatchObject({ id: 'fallback', firstMessage: 'Native preview' })
      expect(listAll).toHaveBeenCalledTimes(1)
      expect(await service.resolveIdByPath(session('fallback').path)).toBe('fallback')
    } finally {
      sdk.mockRestore()
    }
  })
})

describe('SessionService path cache', () => {
  it('drops a cached JSONL path when the file no longer exists', async () => {
    const access = { invalidate: vi.fn() } as unknown as FileAccessService
    const service = new SessionService({} as JsonStore<AppSettings>, {} as WorktreeService, access)
    service.cachePath('missing-session', '/tmp/pi-harness-does-not-exist.jsonl')
    vi.spyOn(service, 'list').mockResolvedValue([])

    await expect(service.resolvePath('missing-session')).resolves.toBeNull()
  })

  it('treats deleting an already missing session as success', async () => {
    const access = { invalidate: vi.fn() } as unknown as FileAccessService
    const service = new SessionService({} as JsonStore<AppSettings>, {} as WorktreeService, access)
    vi.spyOn(service, 'resolvePath').mockResolvedValue(null)

    await expect(service.remove('missing-session')).resolves.toBeUndefined()
  })
})

describe('computeSessionTotalActiveMs', () => {
  it('counts agent activity while excluding human idle before user messages', () => {
    const entries = [
      {
        type: 'message',
        id: '1',
        parentId: null,
        timestamp: '2026-08-21T10:00:00.000Z',
        message: { role: 'user' }
      },
      {
        type: 'message',
        id: '2',
        parentId: '1',
        timestamp: '2026-08-21T10:00:04.000Z',
        message: { role: 'assistant' }
      },
      {
        type: 'message',
        id: '3',
        parentId: '2',
        timestamp: '2026-08-21T12:00:00.000Z',
        message: { role: 'user' }
      },
      {
        type: 'message',
        id: '4',
        parentId: '3',
        timestamp: '2026-08-21T12:00:03.000Z',
        message: { role: 'assistant' }
      }
    ]

    expect(computeSessionTotalActiveMs(entries)).toBe(7000)
  })
})

describe('entryToUiMessage', () => {
  it('hides non-display custom messages from the conversation', () => {
    expect(
      entryToUiMessage({
        type: 'message',
        id: 'hidden-message',
        parentId: null,
        timestamp: '2026-09-25T00:00:00.000Z',
        message: {
          role: 'custom',
          customType: 'plan-mode-context',
          content: '',
          display: false
        }
      })
    ).toBeNull()

    expect(
      entryToUiMessage({
        type: 'custom_message',
        id: 'hidden-entry',
        parentId: null,
        timestamp: '2026-09-25T00:00:00.000Z',
        customType: 'plan-mode-context',
        content: '',
        display: false
      })
    ).toBeNull()
  })

  it('restores a persisted image result as an assistant image message', () => {
    expect(
      entryToUiMessage({
        type: 'message',
        id: 'image-entry',
        parentId: 'user-entry',
        timestamp: '2026-09-25T00:00:00.000Z',
        message: {
          role: 'custom',
          customType: 'pi-harness-image-result',
          content: [{ type: 'image', data: 'TQ==', mimeType: 'image/png' }],
          display: true,
          details: { provider: 'step-plan', model: 'step-image-edit-2' },
          timestamp: 1
        }
      })
    ).toEqual({
      role: 'assistant',
      content: [{ type: 'image', data: 'TQ==', mimeType: 'image/png' }],
      provider: 'step-plan',
      model: 'step-image-edit-2',
      stopReason: 'stop',
      timestamp: 1
    })
  })
})

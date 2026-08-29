import { describe, expect, it, vi } from 'vitest'
import type { JsonStore } from '../services/storage'
import type { AppSettings } from '@shared/ipc/api-types'
import type { WorktreeService } from '../git/worktree-service'
import type { FileAccessService } from '../files/file-access-service'
import { computeSessionTotalActiveMs, SessionService } from './session-service'

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

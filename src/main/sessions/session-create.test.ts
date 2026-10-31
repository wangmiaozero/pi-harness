// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SessionService } from './session-service'
import { loadPiCodingAgent } from '../agent/pi-sdk'
import type { JsonStore } from '../services/storage'
import type { AppSettings } from '@shared/ipc/api-types'
import type { WorktreeService } from '../git/worktree-service'
import type { FileAccessService } from '../files/file-access-service'
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))

describe('explicit empty conversations', () => {
  let root: string
  let service: SessionService | undefined
  afterEach(async () => {
    await service?.close()
    vi.unstubAllEnvs()
    if (root) await fs.rm(root, { recursive: true, force: true })
  })
  it('creates distinct native header-only sessions that survive a new index scan', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-empty-chats-'))
    const config = path.join(root, 'config')
    const cwd = path.join(root, 'workspace')
    await fs.mkdir(cwd)
    await fs.mkdir(config)
    vi.stubEnv('PI_CODING_AGENT_DIR', config)
    const sdk = await loadPiCodingAgent()
    const makeService = () =>
      new SessionService(
        { peek: () => ({ manualConfigDir: config }) } as unknown as JsonStore<AppSettings>,
        {
          resolveProject: async () => ({ projectRoot: null, branch: null, isWorktree: false })
        } as unknown as WorktreeService,
        { invalidate: vi.fn() } as unknown as FileAccessService,
        { list: () => sdk.SessionManager.listAll(), close: async () => {} }
      )
    service = makeService()
    const created = await Promise.all(Array.from({ length: 12 }, () => service!.createEmpty(cwd)))
    expect(new Set(created.map((s) => s.id)).size).toBe(12)
    for (const info of created) {
      expect(info).toMatchObject({ cwd, messageCount: 0, transient: false })
      expect(info.path.startsWith(path.join(config, 'sessions') + path.sep)).toBe(true)
      const entries = (await fs.readFile(info.path, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
      expect(entries).toEqual([expect.objectContaining({ type: 'session', id: info.id, cwd })])
    }
    await service.close()
    service = makeService()
    expect((await service.list()).map((s) => s.id).sort()).toEqual(created.map((s) => s.id).sort())
    expect((await service.get(created[0].id)).context.messages).toEqual([])
    await service.close()
    await expect(service.createEmpty(cwd)).rejects.toThrow('closed')
  }, 30000)
})

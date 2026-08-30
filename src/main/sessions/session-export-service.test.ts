import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { SessionService } from './session-service'
import { SessionExportService } from './session-export-service'
import { projectExportSchema } from '@shared/schemas/workspace'

const { showSaveDialog } = vi.hoisted(() => ({ showSaveDialog: vi.fn() }))
vi.mock('electron', () => ({ dialog: { showSaveDialog }, BrowserWindow: vi.fn() }))

const temporaryDirectories: string[] = []
afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  )
  vi.clearAllMocks()
})

describe('project chat export', () => {
  it.each(['html', 'markdown'] as const)(
    'exports only the supplied chats once as %s',
    async (format) => {
      const dir = await mkdtemp(path.join(os.tmpdir(), 'pi-project-export-test-'))
      temporaryDirectories.push(dir)
      const destination = path.join(dir, `export.${format}`)
      showSaveDialog.mockResolvedValue({ canceled: false, filePath: destination })
      const get = vi.fn(async (id: string) => ({
        sessionId: id,
        info: { name: id },
        context: { messages: [{ role: 'user', content: `message-${id}` }] }
      }))
      const service = new SessionExportService({ get } as unknown as SessionService)
      expect(await service.exportProject('<script>project</script>', ['a', 'b', 'a'], format)).toBe(
        destination
      )
      expect(get.mock.calls).toEqual([['a'], ['b']])
      const content = await readFile(destination, 'utf8')
      expect(content).toContain('message-a')
      expect(content).toContain('message-b')
      if (format === 'html') {
        expect(content).not.toContain('<script>')
        expect(content).toContain('&lt;script&gt;')
      }
    }
  )

  it('does not read or write anything when the save dialog is cancelled', async () => {
    showSaveDialog.mockResolvedValue({ canceled: true })
    const get = vi.fn()
    const service = new SessionExportService({ get } as unknown as SessionService)
    expect(await service.exportProject('project', ['a'], 'html')).toBeNull()
    expect(get).not.toHaveBeenCalled()
  })

  it('rejects empty or invalid export input', () => {
    expect(
      projectExportSchema.safeParse({ name: 'p', sessionIds: [], format: 'html' }).success
    ).toBe(false)
    expect(
      projectExportSchema.safeParse({ name: '', sessionIds: ['a'], format: 'html' }).success
    ).toBe(false)
    expect(
      projectExportSchema.safeParse({ name: 'p', sessionIds: ['a'], format: 'zip' }).success
    ).toBe(false)
  })
})

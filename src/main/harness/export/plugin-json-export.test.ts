// @vitest-environment node
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { dialog } from 'electron'
import { exportAuthorizedJson } from './run-export-service'
vi.mock('electron', () => ({ dialog: { showSaveDialog: vi.fn() } }))
const temporary: string[] = []
afterEach(async () => {
  vi.clearAllMocks()
  for (const dir of temporary.splice(0)) await fs.rm(dir, { recursive: true, force: true })
})
describe('authorized plugin JSON export', () => {
  it('sends no trace evidence to a plugin if native destination selection is canceled', async () => {
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: true, filePath: '' })
    const generate = vi.fn(async () => ({ secret: 'must never be read' }))
    expect((await exportAuthorizedJson(generate)).cancelled).toBe(true)
    expect(generate).not.toHaveBeenCalled()
  })
  it('uses the existing export redactor and writes only the native-selected JSON destination', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-json-export-'))
    temporary.push(dir)
    const file = path.join(dir, 'trace.json')
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: file })
    expect(
      (
        await exportAuthorizedJson(async () => ({
          schemaVersion: 1,
          apiKey: 'never-export-this-key',
          message: 'Bearer secret-value'
        }))
      ).cancelled
    ).toBe(false)
    const text = await fs.readFile(file, 'utf8')
    expect(text).not.toContain('never-export-this-key')
    expect(text).not.toContain('secret-value')
    expect(JSON.parse(text).schemaVersion).toBe(1)
  })
})

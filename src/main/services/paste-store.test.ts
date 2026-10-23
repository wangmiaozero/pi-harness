import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { pastedDirectory, savePastedFiles } from './paste-store'

describe('paste store', () => {
  it('scopes directories per session and falls back to a draft scope', () => {
    expect(pastedDirectory('/data', 'session-1')).toBe(path.join('/data', 'pasted', 'session-1'))
    expect(pastedDirectory('/data', null)).toBe(path.join('/data', 'pasted', 'draft'))
    expect(pastedDirectory('/data', '../escape')).toBe(path.join('/data', 'pasted', 'draft'))
  })

  it('saves payloads with sanitized collision-safe names', async () => {
    const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-harness-paste-'))
    try {
      const files = await savePastedFiles(userData, 'session-1', [
        { name: '../../evil.png', mimeType: 'image/png', data: new Uint8Array([1]).buffer },
        {
          name: 'notes.txt',
          mimeType: 'text/plain',
          data: new TextEncoder().encode('hello').buffer
        }
      ])
      expect(files).toHaveLength(2)
      expect(files[0].kind).toBe('image')
      expect(files[0].name).not.toContain('..')
      expect(files[0].path.startsWith(pastedDirectory(userData, 'session-1'))).toBe(true)
      expect(files[1].kind).toBe('text')
      await expect(fs.access(files[1].path)).resolves.toBeUndefined()
    } finally {
      await fs.rm(userData, { recursive: true, force: true })
    }
  })

  it('rejects empty payloads', async () => {
    await expect(savePastedFiles('/data', null, [])).rejects.toThrow('No pasted files')
  })
})

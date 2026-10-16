import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { AppSettings } from '@shared/ipc/api-types'
import { runWindowsStartupPreflight } from './windows-startup-preflight'

const defaults = {
  theme: 'dark',
  windowMotionEnabled: false,
  screenMotionEnabled: false
} as AppSettings

describe('Windows startup preflight', () => {
  let userData: string

  beforeEach(async () => {
    userData = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-harness-windows-preflight-'))
  })

  afterEach(async () => {
    await fs.rm(userData, { recursive: true, force: true })
  })

  it('preserves settings, workspace grants, credentials and task history on upgrade', async () => {
    const piData = path.join(userData, '..', `${path.basename(userData)}-pi-data`)
    await fs.mkdir(piData)
    await fs.writeFile(path.join(piData, 'session.jsonl'), 'session')
    await fs.writeFile(path.join(userData, 'settings.json'), '{"theme":"light"}')
    await fs.writeFile(path.join(userData, 'secrets.bin'), 'old vault')
    await fs.writeFile(path.join(userData, 'authorized-roots.json'), '{"roots":["C:/project"]}')
    await fs.writeFile(path.join(userData, 'harness-runs.json'), '{"runs":[{"id":"saved"}]}')
    await fs.mkdir(path.join(userData, 'Cache'))
    await fs.writeFile(path.join(userData, 'Cache', 'old'), 'cache')

    try {
      const first = await runWindowsStartupPreflight(userData, '1.6.0', defaults)
      expect(first.repaired).not.toContain('legacy-app-data')
      await expect(fs.readFile(path.join(userData, 'secrets.bin'), 'utf8')).resolves.toBe(
        'old vault'
      )
      await expect(fs.readFile(path.join(userData, 'authorized-roots.json'), 'utf8')).resolves.toBe(
        '{"roots":["C:/project"]}'
      )
      await expect(fs.readFile(path.join(userData, 'harness-runs.json'), 'utf8')).resolves.toBe(
        '{"runs":[{"id":"saved"}]}'
      )
      await expect(fs.access(path.join(userData, 'Cache', 'old'))).rejects.toThrow()
      await expect(fs.readFile(path.join(piData, 'session.jsonl'), 'utf8')).resolves.toBe('session')
      first.markClean()

      const second = await runWindowsStartupPreflight(userData, '1.7.0', defaults)
      expect(second.repaired).not.toContain('legacy-app-data')
      expect(JSON.parse(await fs.readFile(path.join(userData, 'settings.json'), 'utf8'))).toEqual({
        ...defaults,
        theme: 'light'
      })
    } finally {
      await fs.rm(piData, { recursive: true, force: true })
    }
  })

  it('replaces malformed settings and UI state, and keeps a repair copy', async () => {
    const first = await runWindowsStartupPreflight(userData, '1.6.0', defaults)
    first.markClean()
    await fs.writeFile(path.join(userData, 'settings.json'), '{"theme":"broken"}')
    await fs.writeFile(path.join(userData, 'ui-state.json'), '{broken')

    const repaired = await runWindowsStartupPreflight(userData, '1.6.0', defaults)
    expect(repaired.repaired).toEqual(['settings', 'ui-state'])
    expect(JSON.parse(await fs.readFile(path.join(userData, 'settings.json'), 'utf8'))).toEqual(
      defaults
    )
    expect(JSON.parse(await fs.readFile(path.join(userData, 'ui-state.json'), 'utf8'))).toEqual({})
    expect((await fs.readdir(path.join(userData, 'startup-repair'))).length).toBe(2)
  })

  it('clears browser caches after an abnormal exit', async () => {
    const first = await runWindowsStartupPreflight(userData, '1.6.0', defaults)
    await fs.mkdir(path.join(userData, 'GPUCache'))
    await fs.writeFile(path.join(userData, 'GPUCache', 'old'), 'cache')
    const second = await runWindowsStartupPreflight(userData, '1.6.0', defaults)
    expect(second.repaired).toContain('browser-cache')
    await expect(fs.access(path.join(userData, 'GPUCache', 'old'))).rejects.toThrow()
    first.markClean()
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { atomicWriteText } from './storage'

describe('atomicWriteText', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-harness-storage-'))
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    await fs.rm(testDir, { recursive: true, force: true })
  })

  it('durably creates and replaces a file', async () => {
    const target = path.join(testDir, 'settings.json')

    await atomicWriteText(target, 'dark')
    await atomicWriteText(target, 'light')

    expect(await fs.readFile(target, 'utf8')).toBe('light')
  })

  it('uses isolated temporary files for concurrent writes', async () => {
    const target = path.join(testDir, 'ui-state.json')
    const values = Array.from({ length: 8 }, (_, index) => `value-${index}`)

    await Promise.all(values.map((value) => atomicWriteText(target, value)))

    expect(await fs.readFile(target, 'utf8')).toBe(values.at(-1))
    expect((await fs.readdir(testDir)).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it.each(['EPERM', 'EACCES', 'EBUSY'])(
    'replaces the file after a transient Windows %s without removing the original',
    async (code) => {
      const target = path.join(testDir, 'settings.json')
      await fs.writeFile(target, 'original')
      vi.stubGlobal('process', { ...process, platform: 'win32' })
      const rename = fs.rename.bind(fs)
      const replacement = vi.spyOn(fs, 'rename').mockImplementationOnce(async () => {
        expect(await fs.readFile(target, 'utf8')).toBe('original')
        throw Object.assign(new Error('File is busy'), { code })
      })
      replacement.mockImplementationOnce(rename)

      await atomicWriteText(target, 'updated')

      expect(replacement).toHaveBeenCalledTimes(2)
      expect(await fs.readFile(target, 'utf8')).toBe('updated')
      expect(await fs.readdir(testDir)).toEqual(['settings.json'])
    }
  )

  it('keeps the original after a persistent Windows lock and permits a later write', async () => {
    const target = path.join(testDir, 'settings.json')
    await fs.writeFile(target, 'original')
    vi.stubGlobal('process', { ...process, platform: 'win32' })
    const error = Object.assign(new Error('File remains locked'), { code: 'EPERM' })
    const replacement = vi.spyOn(fs, 'rename').mockRejectedValue(error)

    await expect(atomicWriteText(target, 'discarded')).rejects.toBe(error)

    expect(replacement).toHaveBeenCalledTimes(6)
    expect(await fs.readFile(target, 'utf8')).toBe('original')
    expect(await fs.readdir(testDir)).toEqual(['settings.json'])
    replacement.mockRestore()
    await atomicWriteText(target, 'recovered')
    expect(await fs.readFile(target, 'utf8')).toBe('recovered')
  })

  it.each([
    ['linux', 'EPERM'],
    ['darwin', 'EBUSY'],
    ['win32', 'EIO']
  ])('fails immediately for %s %s', async (platform, code) => {
    const target = path.join(testDir, 'settings.json')
    await fs.writeFile(target, 'original')
    vi.stubGlobal('process', { ...process, platform })
    const error = Object.assign(new Error('Cannot replace file'), { code })
    const replacement = vi.spyOn(fs, 'rename').mockRejectedValue(error)

    await expect(atomicWriteText(target, 'discarded')).rejects.toBe(error)

    expect(replacement).toHaveBeenCalledTimes(1)
    expect(await fs.readFile(target, 'utf8')).toBe('original')
    expect(await fs.readdir(testDir)).toEqual(['settings.json'])
  })

  it.skipIf(process.platform !== 'win32')(
    'recovers from a real Windows handle that denies file replacement',
    async () => {
      const target = path.join(testDir, 'settings.json')
      await fs.writeFile(target, 'original')
      // ReadWrite permits ordinary readers/writers but deliberately excludes Delete.
      const locker = spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          "$f = [IO.File]::Open($env:PI_HARNESS_LOCK_TARGET, 'Open', 'Read', 'ReadWrite'); try { [Console]::Out.WriteLine('LOCKED'); [Console]::Out.Flush(); [Console]::In.ReadLine() | Out-Null } finally { $f.Dispose() }"
        ],
        { env: { ...process.env, PI_HARNESS_LOCK_TARGET: target }, windowsHide: true }
      )
      try {
        await new Promise<void>((resolve, reject) => {
          let output = ''
          locker.once('error', reject)
          locker.once('exit', (code) => reject(new Error(`Locker exited early: ${code}`)))
          locker.stdout.on('data', (chunk) => {
            output += String(chunk)
            if (output.includes('LOCKED')) resolve()
          })
        })
        const rename = fs.rename.bind(fs)
        let observedLock = false
        vi.spyOn(fs, 'rename').mockImplementation(async (...args) => {
          try {
            return await rename(...args)
          } catch (error) {
            expect(['EPERM', 'EACCES', 'EBUSY']).toContain((error as NodeJS.ErrnoException).code)
            expect(await fs.readFile(target, 'utf8')).toBe('original')
            if (!observedLock) {
              observedLock = true
              // Sending a release request does not mean the handle is closed.
              // Wait for the real owner to exit before exercising the retry;
              // PowerShell scheduling on ARM64 can exceed the retry window.
              const exited = once(locker, 'close')
              locker.stdin.end('release\n')
              const [code] = await exited
              expect(code).toBe(0)
            }
            throw error
          }
        })

        await atomicWriteText(target, 'updated')

        expect(observedLock).toBe(true)
        expect(await fs.readFile(target, 'utf8')).toBe('updated')
        expect(await fs.readdir(testDir)).toEqual(['settings.json'])
      } finally {
        if (locker.pid && locker.exitCode === null) {
          const exited = once(locker, 'exit')
          locker.kill()
          await exited
        }
      }
    },
    15_000
  )
})

describe('JsonStore commit consistency', () => {
  it('serializes concurrent patches without losing unrelated fields', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-store-'))
    try {
      const { JsonStore } = await import('./storage')
      const target = path.join(dir, 'state.json')
      const store = new JsonStore(target, { a: 0, b: 0 })
      await Promise.all([store.update({ a: 1 }), store.update({ b: 2 })])
      expect(await store.read()).toEqual({ a: 1, b: 2 })
      expect(JSON.parse(await fs.readFile(target, 'utf8'))).toEqual({ a: 1, b: 2 })
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('keeps the committed cache after a failed write and allows retry', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-store-'))
    try {
      const { JsonStore } = await import('./storage')
      const target = path.join(dir, 'state.json')
      const store = new JsonStore(target, { a: 0 })
      await store.write({ a: 1 })
      const rename = vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('disk failure'))
      await expect(store.update({ a: 2 })).rejects.toThrow('disk failure')
      expect(store.peek()).toEqual({ a: 1 })
      expect(JSON.parse(await fs.readFile(target, 'utf8'))).toEqual({ a: 1 })
      rename.mockRestore()
      await store.update({ a: 3 })
      expect(store.peek()).toEqual({ a: 3 })
    } finally {
      vi.restoreAllMocks()
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})

it.each(['{partial', '', '[]', 'null'])(
  'does not overwrite unreadable store data: %s',
  async (content) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-store-corrupt-'))
    try {
      const { JsonStore } = await import('./storage')
      const target = path.join(dir, 'state.json')
      await fs.writeFile(target, content)
      const store = new JsonStore(target, { a: 0 })
      expect(await store.read()).toEqual({ a: 0 })
      await expect(store.update({ a: 1 })).rejects.toThrow('repair it before saving')
      expect(await fs.readFile(target, 'utf8')).toBe(content)
      await fs.writeFile(target, '{"a":2}')
      store.invalidate()
      await store.update({ a: 3 })
      expect(store.peek()).toEqual({ a: 3 })
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  }
)

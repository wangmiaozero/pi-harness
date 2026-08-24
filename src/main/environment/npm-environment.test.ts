import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ensureWritableNpmPrefix, npmBinDirectory } from './npm-environment'

describe('npm global prefix repair', () => {
  it('switches an unwritable global prefix to a user prefix without sudo', async () => {
    const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-harness-npm-prefix-'))
    const userPrefix = path.join(sandbox, 'npm-global')
    const inspectPrefix = vi
      .fn()
      .mockResolvedValueOnce({ prefix: '/usr/local', binDir: '/usr/local/bin', writable: false })
      .mockResolvedValueOnce({
        prefix: userPrefix,
        binDir: npmBinDirectory(userPrefix),
        writable: true
      })
    const runNpmCommand = vi.fn().mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
      signal: null
    })
    const persistPath = vi.fn().mockResolvedValue(undefined)

    try {
      const result = await ensureWritableNpmPrefix('/tmp/bin/npm', {
        nodePath: '/tmp/bin/node',
        userPrefix,
        backupRoot: path.join(sandbox, 'backups'),
        inspectPrefix,
        runNpmCommand,
        persistPath,
        backupConfig: async () => undefined
      })

      expect(runNpmCommand).toHaveBeenCalledWith(
        '/tmp/bin/npm',
        ['config', 'set', 'prefix', userPrefix],
        expect.objectContaining({ nodePath: '/tmp/bin/node' })
      )
      expect(persistPath).toHaveBeenCalledWith([npmBinDirectory(userPrefix)], expect.any(Object))
      expect(runNpmCommand.mock.calls.flat(Infinity)).not.toContain('sudo')
      expect(result).toMatchObject({ prefix: userPrefix, writable: true, changed: true })
    } finally {
      await fs.rm(sandbox, { recursive: true, force: true })
    }
  })
})

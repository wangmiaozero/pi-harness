import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { runCommand } from './command-runner'
import { ensureWritableNpmPrefix, npmBinDirectory, npmEnvironment } from './npm-environment'

describe('npm global prefix repair', () => {
  it('does not pass project npm config variables into managed npm commands', async () => {
    const environment = npmEnvironment('/runtime/bin/node', '/user/npm', {
      PATH: '/usr/bin',
      HTTP_PROXY: 'http://proxy.example.test:8080',
      npm_config_python: '/project/python',
      npm_config_auto_install_peers: 'true',
      NPM_CONFIG_ELECTRON_MIRROR: 'https://mirror.example.test'
    })

    expect(environment).toMatchObject({
      HTTP_PROXY: 'http://proxy.example.test:8080',
      NPM_CONFIG_PREFIX: '/user/npm',
      npm_config_fund: 'false',
      npm_config_audit: 'false'
    })
    expect(environment.npm_config_python).toBeUndefined()
    expect(environment.npm_config_auto_install_peers).toBeUndefined()
    expect(environment.NPM_CONFIG_ELECTRON_MIRROR).toBeUndefined()
  })

  it('removes cleared npm config variables from the spawned process', async () => {
    const previous = process.env.npm_config_python
    process.env.npm_config_python = '/project/python'
    try {
      const result = await runCommand(
        process.execPath,
        ['-e', 'process.stdout.write(String(process.env.npm_config_python))'],
        { env: npmEnvironment() }
      )
      expect(result).toMatchObject({ exitCode: 0, stdout: 'undefined' })
    } finally {
      if (previous === undefined) delete process.env.npm_config_python
      else process.env.npm_config_python = previous
    }
  })

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

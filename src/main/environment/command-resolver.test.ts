import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { resolveExecutable, resolveLoginShellPath } from './command-resolver'

describe.runIf(process.platform !== 'win32')('login-shell command resolver', () => {
  let sandbox = ''
  const previousShell = process.env.SHELL
  const previousResolved = process.env.PI_HARNESS_TEST_RESOLVED

  afterEach(async () => {
    vi.unstubAllEnvs()
    process.env.SHELL = previousShell
    if (previousResolved === undefined) delete process.env.PI_HARNESS_TEST_RESOLVED
    else process.env.PI_HARNESS_TEST_RESOLVED = previousResolved
    if (sandbox) await fs.rm(sandbox, { recursive: true, force: true })
  })

  it('finds a GUI-invisible executable through the user login shell', async () => {
    sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-harness-shell-resolver-'))
    const executable = path.join(sandbox, 'pi-harness-login-shell-fixture')
    const shell = path.join(sandbox, 'login-shell')
    await fs.writeFile(executable, '#!/bin/sh\nprintf "9.8.7\\n"\n')
    await fs.writeFile(shell, '#!/bin/sh\nprintf "%s\\n" "$PI_HARNESS_TEST_RESOLVED"\n')
    await Promise.all([fs.chmod(executable, 0o755), fs.chmod(shell, 0o755)])
    process.env.SHELL = shell
    process.env.PI_HARNESS_TEST_RESOLVED = executable

    const result = await resolveExecutable('pi-harness-login-shell-fixture')

    expect(result).toMatchObject({
      found: true,
      path: executable,
      version: '9.8.7',
      source: 'login-shell'
    })
  })

  it('loads interactive shell configuration when resolving PATH', async () => {
    sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-harness-shell-path-'))
    const expectedPath = path.join(sandbox, 'bin')
    const shell = path.join(sandbox, 'login-shell')
    await fs.writeFile(
      shell,
      '#!/bin/sh\n[ "$1" = "-ilc" ] || exit 23\nprintf "__PI_HARNESS_PATH__%s\\n" "$PI_HARNESS_TEST_RESOLVED"\n'
    )
    await fs.chmod(shell, 0o755)
    process.env.SHELL = shell
    process.env.PI_HARNESS_TEST_RESOLVED = expectedPath

    await expect(resolveLoginShellPath()).resolves.toEqual({ shell, path: expectedPath })
  })

  it('probes the runtime behind a shell function and copies only manager configuration', async () => {
    sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-harness-node shell-'))
    const shell = path.join(sandbox, 'login shell')
    await fs.writeFile(
      shell,
      [
        '#!/bin/sh',
        '[ "$1" = "-ilc" ] || exit 23',
        'printf "shell startup banner\\n"',
        'export NVM_DIR="$PWD/custom nvm"',
        'export PI_HARNESS_TEST_PRIVATE="fixture-secret"',
        'node() { "$PI_HARNESS_TEST_NODE_BINARY" "$@"; }',
        'eval "$2"'
      ].join('\n')
    )
    await fs.chmod(shell, 0o755)
    vi.stubEnv('SHELL', shell)
    vi.stubEnv('PI_HARNESS_TEST_NODE_BINARY', process.execPath)

    const result = await resolveLoginShellPath({ probeNode: true, cwd: sandbox })

    expect(result.node).toEqual({ path: process.execPath, version: process.version })
    expect(result.env?.NVM_DIR).toBe(path.join(await fs.realpath(sandbox), 'custom nvm'))
    expect(result.env).not.toHaveProperty('PI_HARNESS_TEST_PRIVATE')
  })

  it('skips a broken shim and runs the next candidate with the selected Node PATH', async () => {
    sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-harness-broken shim-'))
    const broken = path.join(sandbox, 'broken')
    const good = path.join(sandbox, 'good')
    await fs.mkdir(broken)
    await fs.mkdir(good)
    for (const [directory, script] of [
      [broken, '#!/bin/sh\nexit 1\n'],
      [good, '#!/usr/bin/env node\nprocess.stdout.write(process.version)\n']
    ]) {
      await fs.writeFile(path.join(directory, 'npm'), script)
      await fs.chmod(path.join(directory, 'npm'), 0o755)
    }
    const result = await resolveExecutable('npm', {
      additionalDirectories: [broken, good],
      env: { PATH: path.dirname(process.execPath) },
      loginShell: false,
      requireVersion: true
    })
    expect(result).toMatchObject({ path: path.join(good, 'npm'), version: process.version })
  })
})

describe.runIf(process.platform === 'win32')('Windows command resolver', () => {
  it.each(['cmd', 'bat'])(
    'resolves and executes a .%s shim in a path containing spaces',
    async (extension) => {
      const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-harness-windows shim-'))
      try {
        const executable = path.join(sandbox, `fixture-tool.${extension}`)
        await fs.writeFile(executable, '@echo off\r\nnode -p process.version\r\n')
        const result = await resolveExecutable('fixture-tool', {
          additionalDirectories: [sandbox],
          env: { PATH: path.dirname(process.execPath) },
          requireVersion: true
        })
        expect(result).toMatchObject({ found: true, path: executable, version: process.version })
      } finally {
        await fs.rm(sandbox, { recursive: true, force: true })
      }
    }
  )

  it('probes the actual Node runtime through PowerShell without losing script quotes', async () => {
    const result = await resolveLoginShellPath({ probeNode: true })
    expect(result.node).toEqual({ path: process.execPath, version: process.version })
    expect(result.path).toBeTruthy()
  }, 25_000)
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { PiProcessService } from './pi-process'
import * as commandResolver from '../environment/command-resolver'

beforeEach(() => {
  vi.spyOn(commandResolver, 'resolveLoginShellPath').mockImplementation(async () => ({
    shell: null,
    path: process.env.PATH ?? null
  }))
})
afterEach(() => vi.restoreAllMocks())

const describeWindows = process.platform === 'win32' ? describe : describe.skip

describe('PiProcessService environment override', () => {
  it('does not fall through to a host Pi when the explicit environment path is missing', async () => {
    const previous = process.env.PI_HARNESS_PI_CLI_PATH
    const missing = path.join(os.tmpdir(), `pi-harness-missing-${Date.now()}`, 'pi')
    process.env.PI_HARNESS_PI_CLI_PATH = missing
    try {
      await expect(new PiProcessService().resolveCliPath()).resolves.toBeNull()
    } finally {
      if (previous === undefined) delete process.env.PI_HARNESS_PI_CLI_PATH
      else process.env.PI_HARNESS_PI_CLI_PATH = previous
    }
  })

  it('spawns the CLI with an enriched PATH beyond the inherited one', async () => {
    const previous = process.env.PI_HARNESS_PI_CLI_PATH
    const previousPath = process.env.PATH
    const testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-harness-path-'))
    const cliPath = path.join(testDir, 'cli.js')
    await fs.writeFile(
      cliPath,
      "process.stdout.write('__PATH__' + (process.env.PATH || '') + '__END__')\n"
    )
    await fs.chmod(cliPath, 0o755)
    process.env.PI_HARNESS_PI_CLI_PATH = cliPath
    // Simulate a GUI launch: Finder/Dock apps inherit a minimal system PATH.
    process.env.PATH = ['/usr/bin', '/bin'].join(path.delimiter)
    try {
      const result = await new PiProcessService().exec({ args: ['--version'] })
      const marker = result.stdout.match(/__PATH__(.*)__END__/)
      expect(marker).not.toBeNull()
      const entries = (marker?.[1] ?? '').split(path.delimiter).filter(Boolean)
      // When no shell environment is available, retain the inherited PATH.
      expect(entries.slice(0, 2)).toEqual(['/usr/bin', '/bin'])
      expect(entries.length).toBeGreaterThan(2)
    } finally {
      process.env.PATH = previousPath
      if (previous === undefined) delete process.env.PI_HARNESS_PI_CLI_PATH
      else process.env.PI_HARNESS_PI_CLI_PATH = previous
      await fs.rm(testDir, { recursive: true, force: true })
    }
  }, 20_000)

  it('uses the project shell runtime and re-probes after a version switch', async () => {
    const testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-harness-node-switch-'))
    const cliPath = path.join(testDir, 'cli.js')
    await fs.writeFile(cliPath, 'process.stdout.write(process.env.PATH)')
    await fs.chmod(cliPath, 0o755)
    const shellPath = path.join(testDir, 'shims')
    const probe = vi.mocked(commandResolver.resolveLoginShellPath)
    const service = new PiProcessService()
    try {
      for (const version of ['22', '24']) {
        const nodeBin = path.join(testDir, version, 'bin')
        probe.mockResolvedValue({
          shell: 'fixture-shell',
          path: shellPath,
          node: { path: path.join(nodeBin, 'node'), version: `v${version}.0.0` }
        })
        const result = await service.exec({ args: [], cliPath, cwd: testDir })
        expect(result.stdout.split(path.delimiter).slice(0, 2)).toEqual([nodeBin, shellPath])
        expect(probe).toHaveBeenLastCalledWith({ probeNode: true, cwd: testDir })
      }
    } finally {
      await fs.rm(testDir, { recursive: true, force: true })
    }
  })

  it('runs a JavaScript CLI through packaged Electron in Node mode', async () => {
    const previous = process.env.PI_HARNESS_PI_CLI_PATH
    const testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-harness-js-cli-'))
    const cliPath = path.join(testDir, 'cli.js')
    await fs.writeFile(
      cliPath,
      "process.stdout.write(process.env.ELECTRON_RUN_AS_NODE === '1' ? '1.2.3' : 'wrong-mode')\n"
    )
    await fs.chmod(cliPath, 0o755)
    process.env.PI_HARNESS_PI_CLI_PATH = cliPath
    try {
      await expect(new PiProcessService().version()).resolves.toBe('1.2.3')
    } finally {
      if (previous === undefined) delete process.env.PI_HARNESS_PI_CLI_PATH
      else process.env.PI_HARNESS_PI_CLI_PATH = previous
      await fs.rm(testDir, { recursive: true, force: true })
    }
  })
})

describeWindows('PiProcessService on Windows', () => {
  let testDir: string
  let previousCliPath: string | undefined

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-harness-process-'))
    previousCliPath = process.env.PI_HARNESS_PI_CLI_PATH
  })

  afterEach(async () => {
    if (previousCliPath === undefined) delete process.env.PI_HARNESS_PI_CLI_PATH
    else process.env.PI_HARNESS_PI_CLI_PATH = previousCliPath
    await fs.rm(testDir, { recursive: true, force: true })
  })

  it('prefers the Windows npm shim over the extensionless Unix shim', async () => {
    const unixShim = path.join(testDir, 'pi')
    const windowsShim = `${unixShim}.cmd`
    await fs.writeFile(unixShim, '#!/bin/sh\necho 9.9.9\n', 'utf8')
    await fs.writeFile(windowsShim, '@echo off\r\necho 1.2.3\r\n', 'utf8')

    const resolved = await new PiProcessService().resolveCliPath(unixShim)

    expect(resolved).toBe(windowsShim)
  })

  it('executes a cmd shim through the Windows command interpreter', async () => {
    const unixShim = path.join(testDir, 'pi')
    await fs.writeFile(unixShim, '#!/bin/sh\necho 9.9.9\n', 'utf8')
    await fs.writeFile(`${unixShim}.cmd`, '@echo off\r\necho 1.2.3\r\n', 'utf8')
    process.env.PI_HARNESS_PI_CLI_PATH = unixShim

    const version = await new PiProcessService().version()

    expect(version).toBe('1.2.3')
  })
})

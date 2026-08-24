import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { PiProcessService } from './pi-process'

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

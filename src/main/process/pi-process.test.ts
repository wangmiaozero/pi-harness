import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { PiProcessService } from './pi-process'

const describeWindows = process.platform === 'win32' ? describe : describe.skip

describeWindows('PiProcessService on Windows', () => {
  let testDir: string
  let previousCliPath: string | undefined

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-switch-process-'))
    previousCliPath = process.env.PI_SWITCH_PI_CLI_PATH
  })

  afterEach(async () => {
    if (previousCliPath === undefined) delete process.env.PI_SWITCH_PI_CLI_PATH
    else process.env.PI_SWITCH_PI_CLI_PATH = previousCliPath
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
    process.env.PI_SWITCH_PI_CLI_PATH = unixShim

    const version = await new PiProcessService().version()

    expect(version).toBe('1.2.3')
  })
})

import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { resolveExecutable } from './command-resolver'

describe.runIf(process.platform !== 'win32')('login-shell command resolver', () => {
  let sandbox = ''
  const previousShell = process.env.SHELL
  const previousResolved = process.env.PI_HARNESS_TEST_RESOLVED

  afterEach(async () => {
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
})

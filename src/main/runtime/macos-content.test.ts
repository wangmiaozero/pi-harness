// @vitest-environment node
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { verifyDistribution } from './distribution.mjs'

it.skipIf(process.platform !== 'darwin')(
  'accepts a controlled Pi re-signature but rejects changed executable content with a valid ad-hoc signature',
  async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-signature-'))
    try {
      const directory = path.join(temporary, 'pi')
      await fs.cp(path.resolve(`resources/runtimes/darwin-${process.arch}/pi`), directory, {
        recursive: true
      })
      const executable = path.join(directory, 'pi')
      await promisify(execFile)('/usr/bin/codesign', ['--force', '--sign', '-', executable])
      await expect(
        verifyDistribution(directory, 'pi', 'darwin', process.arch)
      ).resolves.toBeTruthy()
      const file = await fs.open(executable, 'r+')
      try {
        const value = Buffer.alloc(1)
        await file.read(value, 0, 1, 10000)
        value[0] ^= 1
        await file.write(value, 0, 1, 10000)
      } finally {
        await file.close()
      }
      await promisify(execFile)('/usr/bin/codesign', ['--force', '--sign', '-', executable])
      await expect(verifyDistribution(directory, 'pi', 'darwin', process.arch)).rejects.toThrow(
        'content'
      )
    } finally {
      await fs.rm(temporary, { recursive: true, force: true })
    }
  },
  30000
)

it.skipIf(
  process.platform !== 'darwin' ||
    !existsSync(path.resolve('resources/runtimes/darwin-x64/pi/runtime-receipt.json'))
)(
  'verifies x64 nested native module re-signing without executing foreign binaries and rejects changed module code',
  async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-nested-signature-'))
    try {
      const directory = path.join(temporary, 'pi')
      await fs.cp(path.resolve('resources/runtimes/darwin-x64/pi'), directory, { recursive: true })
      for (const relative of ['native/darwin/prebuilds/darwin-x64/darwin-platform.node', 'pi'])
        await promisify(execFile)('/usr/bin/codesign', [
          '--force',
          '--sign',
          '-',
          path.join(directory, relative)
        ])
      await expect(verifyDistribution(directory, 'pi', 'darwin', 'x64')).resolves.toBeTruthy()
      const addon = path.join(directory, 'native/darwin/prebuilds/darwin-x64/darwin-platform.node')
      const file = await fs.open(addon, 'r+')
      try {
        const byte = Buffer.alloc(1)
        await file.read(byte, 0, 1, 10000)
        byte[0] ^= 1
        await file.write(byte, 0, 1, 10000)
      } finally {
        await file.close()
      }
      await promisify(execFile)('/usr/bin/codesign', ['--force', '--sign', '-', addon])
      await expect(verifyDistribution(directory, 'pi', 'darwin', 'x64')).rejects.toThrow('content')
    } finally {
      await fs.rm(temporary, { recursive: true, force: true })
    }
  },
  30000
)

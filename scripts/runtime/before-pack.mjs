import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

export default async function beforePack(context) {
  const arch = { 1: 'x64', 3: 'arm64' }[context.arch]
  if (!arch) throw new Error('Only official x64 and arm64 runtime distributions can be packaged')
  const args = [
    path.join(context.packager.projectDir, 'scripts/runtime/prepare-runtime.mjs'),
    `--platform=${context.electronPlatformName}`,
    `--arch=${arch}`
  ]
  if (process.env.PI_HARNESS_RUNTIME_OFFLINE === '1') args.push('--offline')
  const result = await promisify(execFile)(process.execPath, args, {
    cwd: context.packager.projectDir,
    timeout: 600_000,
    maxBuffer: 4 * 1024 * 1024
  })
  process.stdout.write(result.stdout)
}

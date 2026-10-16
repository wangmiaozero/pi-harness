import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { binaryIdentity } from '../../src/main/runtime/binary-identity.mjs'
import { verifyDistribution } from '../../src/main/runtime/distribution.mjs'
const exec = promisify(execFile)
export async function verifyMacBundle(app, arch) {
  let binaries = 0
  async function walk(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) await walk(file)
      else if (entry.isFile() && (await binaryIdentity(file))?.platform === 'darwin') {
        await exec('/usr/bin/codesign', ['--verify', '--strict', '--verbose=2', file])
        binaries++
      }
    }
  }
  await walk(app)
  if (!binaries) throw new Error('No signed Mach-O executables were verified')
  await exec('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', app])
  for (const kind of ['pi', 'node'])
    await verifyDistribution(
      path.join(app, 'Contents/Resources/runtimes', kind),
      kind,
      'darwin',
      arch
    )
  return {
    binaries,
    signature: 'PASS',
    appleIdentity: 'NOT_VERIFIED',
    notarization: 'NOT_VERIFIED'
  }
}
export default async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return
  const arch = { 1: 'x64', 3: 'arm64' }[context.arch]
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const result = await verifyMacBundle(app, arch)
  const directory = path.join(context.packager.projectDir, 'out/runtime-validation')
  await fs.mkdir(directory, { recursive: true })
  await fs.writeFile(
    path.join(directory, `signing-darwin-${arch}.json`),
    JSON.stringify(result, null, 2) + '\n'
  )
}

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { installedSdkVersions } from '../../src/main/runtime/sdk-matrix.mjs'
import { PI_SDK_PACKAGES } from '../../src/main/runtime/version-sources.mjs'
import { catalog } from '../../src/main/runtime/distribution.mjs'

export async function verifySdkMatrix(
  root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
) {
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
  const installed = await installedSdkVersions()
  for (const name of PI_SDK_PACKAGES) {
    if (installed[name] !== catalog.pi.version)
      throw new Error(`Pi SDK/Binary version mismatch: ${name}`)
    const declared = pkg.dependencies[name] ?? pkg.devDependencies[name]
    if (declared && declared !== catalog.pi.version)
      throw new Error(`Pi SDK must be pinned exactly: ${name}`)
  }
  const lock = await fs.readFile(path.join(root, 'pnpm-lock.yaml'), 'utf8')
  for (const match of lock.matchAll(/^\s+['"]?(@earendil-works\/pi-[^@'":\s]+)@([^('"\s:]+)/gm))
    if (PI_SDK_PACKAGES.includes(match[1]) && match[2] !== catalog.pi.version)
      throw new Error(`Mixed Pi versions in pnpm lockfile: ${match[1]}`)
  return installed
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.stdout.write(
    JSON.stringify(
      { piBinary: catalog.pi.version, sdk: await verifySdkMatrix(), aligned: true },
      null,
      2
    ) + '\n'
  )

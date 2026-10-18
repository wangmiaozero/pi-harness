import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, Platform, Arch } from 'electron-builder'
import { cleanUnpackedMac } from './clean-unpacked-mac.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export async function buildMac({
  projectDir = root,
  arches = [process.arch],
  nomascot = false
} = {}) {
  if (!arches.length || arches.some((arch) => !['arm64', 'x64'].includes(arch)))
    throw new Error('macOS packaging requires arm64 or x64')
  const directory = path.join(projectDir, 'release', ...(nomascot ? ['nomascot'] : []))
  try {
    return await build({
      projectDir,
      targets: Platform.MAC.createTarget(undefined, ...arches.map((arch) => Arch[arch])),
      config: nomascot ? 'electron-builder.nomascot.yml' : 'electron-builder.yml',
      publish: 'never'
    })
  } finally {
    // Wait for all DMG/ZIP work to finish, including failed builds, before removing staging apps.
    await cleanUnpackedMac(directory)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.some((arg) => !['--arm64', '--x64', '--nomascot'].includes(arg))) {
    process.stderr.write('Usage: electron-builder-mac.mjs [--arm64] [--x64] [--nomascot]\n')
    process.exitCode = 1
  } else {
    const arches = ['arm64', 'x64'].filter((arch) => args.includes(`--${arch}`))
    buildMac({
      arches: arches.length ? arches : [process.arch],
      nomascot: args.includes('--nomascot')
    }).catch((error) => {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    })
  }
}

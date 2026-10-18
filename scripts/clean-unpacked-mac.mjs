/**
 * electron-builder leaves unpacked *.app under release/mac* after DMG build.
 * Spotlight / Launchpad indexes those copies → duplicate "Pi-Harness.app" icons.
 * Keep the DMG, ZIP and update files; delete unpacked app bundles.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const UNPACKED = ['mac', 'mac-arm64', 'mac-universal', 'mac-x64']

export async function cleanUnpackedMac(directory) {
  for (const name of UNPACKED) {
    const dir = path.join(directory, name)
    try {
      await fs.lstat(dir)
    } catch (err) {
      if (err.code === 'ENOENT') continue
      throw err
    }
    await fs.rm(dir, { recursive: true, force: true })
    process.stdout.write(`removed ${path.relative(root, dir)}\n`)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const release = path.join(root, 'release', process.argv.includes('--nomascot') ? 'nomascot' : '')
  cleanUnpackedMac(release).catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
}

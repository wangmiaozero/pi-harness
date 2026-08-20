/**
 * electron-builder leaves unpacked *.app under release/mac* after DMG build.
 * Spotlight / Launchpad indexes those copies → duplicate "Pi-Switch.app" icons.
 * Keep only the DMG (and yml/blockmap); delete unpacked app bundles.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const release = path.join(root, 'release')

const UNPACKED = ['mac', 'mac-arm64', 'mac-universal', 'mac-x64']

async function main() {
  let removed = 0
  for (const name of UNPACKED) {
    const dir = path.join(release, name)
    try {
      await fs.rm(dir, { recursive: true, force: true })
      removed++
      console.log(`removed ${path.relative(root, dir)}`)
    } catch (err) {
      console.warn(`skip ${name}:`, err instanceof Error ? err.message : err)
    }
  }
  if (removed === 0) console.log('no unpacked mac apps to clean')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

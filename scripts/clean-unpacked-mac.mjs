/**
 * electron-builder leaves unpacked *.app under release/mac* after DMG build.
 * Spotlight / Launchpad indexes those copies → duplicate "Pi-Harness.app" icons.
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
      process.stdout.write(`removed ${path.relative(root, dir)}\n`)
    } catch (err) {
      console.warn(`skip ${name}:`, err instanceof Error ? err.message : err)
    }
  }
  if (removed === 0) process.stdout.write('no unpacked mac apps to clean\n')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { verifyInstaller } from './security/manifest.mjs'
/** Linux-only file transaction. Never use AppImageUpdater's unlink-before-move. */
export async function stageAppImage(current, verified, candidate) {
  if (!path.isAbsolute(current) || !current.endsWith('.AppImage'))
    throw new Error('This application is not running from a supported AppImage.')
  const stat = await fs.lstat(current)
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    (await fs.realpath(current)) !== current ||
    (process.getuid && stat.uid !== process.getuid())
  )
    throw new Error('The AppImage is not a regular file owned by the current user.')
  const handle = await fs.open(current, 'r')
  try {
    const header = Buffer.alloc(11)
    await handle.read(header, 0, header.length, 0)
    if (
      header.subarray(0, 4).toString('hex') !== '7f454c46' ||
      header.subarray(8, 11).toString('hex') !== '414902'
    )
      throw new Error('The running file is not an AppImage type 2 container.')
  } finally {
    await handle.close()
  }
  await fs.access(path.dirname(current), constants.W_OK)
  const nonce = randomUUID()
  const staging = path.join(path.dirname(current), `.pi-harness-${nonce}.new`)
  const backup = path.join(path.dirname(current), `.pi-harness-${nonce}.backup.AppImage`)
  let linked = false,
    replaced = false
  try {
    await fs.copyFile(verified, staging, constants.COPYFILE_EXCL)
    await verifyInstaller(staging, candidate.installer)
    await fs.chmod(staging, (stat.mode & 0o777) | 0o100)
    const synced = await fs.open(staging, 'r+')
    try {
      await synced.sync()
    } finally {
      await synced.close()
    }
    await fs.link(current, backup)
    linked = true
    await fs.rename(staging, current)
    replaced = true
    return { backup, target: current }
  } finally {
    await fs.rm(staging, { force: true })
    if (linked && !replaced) await fs.rm(backup, { force: true })
  }
}

import fs from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { assertOfficialUrl } from './transport.mjs'

const exec = promisify(execFile)

/** Preserve OS Internet-origin checks; a valid release signature does not replace them. */
export async function markDownloadOrigin(file: string, source: string): Promise<void> {
  assertOfficialUrl(source)
  if (process.platform === 'darwin') {
    const quarantine = `0083;${Math.floor(Date.now() / 1000).toString(16)};Pi-Harness;`
    const options = { encoding: 'utf8' as const, timeout: 10_000, maxBuffer: 16 * 1024 }
    await exec('/usr/bin/xattr', ['-w', 'com.apple.quarantine', quarantine, file], options)
    const result = await exec('/usr/bin/xattr', ['-p', 'com.apple.quarantine', file], options)
    if (result.stdout.trim() !== quarantine)
      throw new Error('Download quarantine could not be confirmed')
  } else if (process.platform === 'win32') {
    const zone = `[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=${source}\r\n`
    // This stream belongs to our fresh private .part file; no shell or PowerShell.
    await fs.writeFile(`${file}:Zone.Identifier`, zone, { encoding: 'utf8' })
    if ((await fs.readFile(`${file}:Zone.Identifier`, 'utf8')) !== zone)
      throw new Error('Download Internet Zone could not be confirmed')
  }
}

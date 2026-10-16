import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'

// codesign removes the signature load command and restores __LINKEDIT sizes.
// Hash that canonical copy, never mutate the installed/upstream executable.
export async function macosContentHash(executable) {
  if (process.platform !== 'darwin') throw new Error('macOS content checks require a native runner')
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-content-'))
  try {
    const copy = path.join(temporary, 'binary')
    await fs.copyFile(executable, copy)
    await fs.chmod(copy, 0o700)
    await promisify(execFile)('/usr/bin/codesign', ['--remove-signature', copy], {
      timeout: 30_000
    }).catch((error) => {
      if (!String(error.stderr).includes('code object is not signed at all')) throw error
    })
    const bytes = await fs.readFile(copy)
    if (bytes.readUInt32LE(0) !== 0xfeedfacf) throw new Error('Expected a thin 64-bit Mach-O')
    let offset = 32
    for (let index = 0; index < bytes.readUInt32LE(16); index++) {
      const length = bytes.readUInt32LE(offset + 4)
      if (length < 8 || offset + length > 32 + bytes.readUInt32LE(20))
        throw new Error('Invalid Mach-O load command')
      if (
        bytes.readUInt32LE(offset) === 0x19 &&
        bytes.toString('ascii', offset + 8, offset + 24).replaceAll('\0', '') === '__LINKEDIT'
      ) {
        // codesign retains the old signature allocation in vmsize even after
        // removal. Only that signature-dependent allocation is normalized;
        // fileoff/filesize, all other commands and every payload byte are hashed.
        bytes.writeBigUInt64LE(0n, offset + 32)
      }
      offset += length
    }
    return createHash('sha256').update(bytes).digest('hex')
  } finally {
    await fs.rm(temporary, { recursive: true, force: true })
  }
}

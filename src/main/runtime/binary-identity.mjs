import fs from 'node:fs/promises'

/** Inspect native executable headers before executing an incompatible foreign binary. */
export async function binaryIdentity(file) {
  const handle = await fs.open(file, 'r')
  try {
    const header = Buffer.alloc(4096)
    const { bytesRead } = await handle.read(header, 0, header.length, 0)
    if (bytesRead < 20) return null
    if (header.readUInt32BE(0) === 0x7f454c46) {
      const machine = header[5] === 1 ? header.readUInt16LE(18) : header.readUInt16BE(18)
      return {
        platform: 'linux',
        arch: machine === 183 ? 'arm64' : machine === 62 ? 'x64' : 'unsupported'
      }
    }
    if (header.readUInt32LE(0) === 0xfeedfacf) {
      const cpu = header.readUInt32LE(4)
      return {
        platform: 'darwin',
        arch: cpu === 0x100000c ? 'arm64' : cpu === 0x1000007 ? 'x64' : 'unsupported'
      }
    }
    if (header.toString('ascii', 0, 2) === 'MZ') {
      const offset = header.readUInt32LE(0x3c)
      const pe = Buffer.alloc(6)
      await handle.read(pe, 0, 6, offset)
      if (pe.toString('ascii', 0, 4) !== 'PE\0\0') throw new Error('Invalid PE header')
      return {
        platform: 'win32',
        arch:
          pe.readUInt16LE(4) === 0xaa64
            ? 'arm64'
            : pe.readUInt16LE(4) === 0x8664
              ? 'x64'
              : 'unsupported'
      }
    }
    return null
  } finally {
    await handle.close()
  }
}

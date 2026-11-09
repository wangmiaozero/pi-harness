import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { setImmediate as yieldToLoop } from 'node:timers/promises'

/** Hash a large file without holding the Electron main thread for the whole read. */
export async function sha512FileBase64(file: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash('sha512')
  const stream = createReadStream(file, { highWaterMark: 1024 * 1024 })
  try {
    for await (const chunk of stream) {
      signal?.throwIfAborted()
      hash.update(chunk as Buffer)
      await yieldToLoop()
    }
  } finally {
    stream.destroy()
  }
  return hash.digest('base64')
}

export function integrityMatches(integrity: string, sha512Base64: string): boolean {
  return integrity
    .split(/\s+/)
    .filter(Boolean)
    .some((part) => {
      const splitAt = part.indexOf('-')
      if (splitAt <= 0) return false
      return part.slice(0, splitAt) === 'sha512' && part.slice(splitAt + 1) === sha512Base64
    })
}

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { setImmediate as yieldToLoop } from 'node:timers/promises'

/** Hash a large file without holding the Electron main thread for the whole read. */
export async function sha256File(file: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash('sha256')
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
  return hash.digest('hex')
}

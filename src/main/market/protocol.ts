import { protocol } from 'electron'
import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { parseMarketUrl } from '@shared/market/urls'
import { MARKET_FILE_EXTENSIONS } from './limits'

export const MARKET_PROTOCOL_SCHEME = 'pi-market'

const CONTENT_TYPES: Record<string, string> = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg'
}

export function installMarketProtocol(themeRoot: string, petRoot: string): void {
  const themes = path.resolve(themeRoot)
  const pets = path.resolve(petRoot)
  protocol.handle(MARKET_PROTOCOL_SCHEME, async (request) => {
    const parsed = parseMarketUrl(request.url)
    if (!parsed) return new Response('not found', { status: 404 })
    const extension = path.extname(parsed.parts[parsed.parts.length - 1] ?? '').toLowerCase()
    if (!MARKET_FILE_EXTENSIONS.has(extension) || extension === '.json' || extension === '.md' || extension === '.txt') {
      return new Response('not found', { status: 404 })
    }
    const base = parsed.kind === 'theme' ? themes : pets
    const file = path.resolve(base, parsed.id, ...parsed.parts)
    if (file !== base && !file.startsWith(base + path.sep)) return new Response('not found', { status: 404 })
    try {
      const stat = await fs.lstat(file)
      if (!stat.isFile()) return new Response('not found', { status: 404 })
      const stream = createReadStream(file)
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          stream.on('data', (chunk: Buffer | string) => {
            controller.enqueue(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : new Uint8Array(chunk))
          })
          stream.on('end', () => controller.close())
          stream.on('error', (error) => controller.error(error))
        },
        cancel() {
          stream.destroy()
        }
      })
      return new Response(body, {
        status: 200,
        headers: {
          'content-type': CONTENT_TYPES[extension] ?? 'application/octet-stream',
          'content-length': String(stat.size),
          'cache-control': 'private, max-age=86400',
          'access-control-allow-origin': '*'
        }
      })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}

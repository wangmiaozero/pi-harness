/**
 * `pi-pet://` protocol — read-only image serving for desktop pet packs.
 *
 * A privileged, standard scheme scoped to the pet pack directory. Only
 * `<packId>/<clip>/<frame>.webp` paths resolve; every request is re-validated
 * against the pack root so the renderer cannot read arbitrary files. This
 * keeps pet frames loadable in both the dev renderer (http origin) and
 * packaged builds without weakening `webSecurity` or allowing `file://`.
 */

import { protocol } from 'electron'
import path from 'node:path'
import { createReadStream, promises as fsp } from 'node:fs'
import { isSafeClipDir } from './pack'

export const PET_PROTOCOL_SCHEME = 'pi-pet'
export const PET_PROTOCOL_HOST = 'petpack'
const FRAME_NAME_PATTERN = /^[\w][\w.-]*\.webp$/

/** Register the scheme early (before app ready, alongside other schemes). */
export function registerPetProtocolScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: PET_PROTOCOL_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true }
    }
  ])
}

/** Build a `pi-pet://` URL for a frame inside a pack. Inputs must be safe names. */
export function petFrameUrl(packId: string, clipDir: string, frameFile: string): string {
  if (!/^[\w-]+$/.test(packId) || !isSafeClipDir(clipDir) || !FRAME_NAME_PATTERN.test(frameFile)) {
    throw new Error('Invalid pet frame reference')
  }
  return `${PET_PROTOCOL_SCHEME}://${PET_PROTOCOL_HOST}/${packId}/${clipDir}/${frameFile}`
}

/**
 * Parse and validate a `pi-pet://petpack/<packId>/<clip>/<frame>.webp` URL.
 * Returns the absolute file path, or null for anything unexpected.
 */
export function resolvePetFramePath(packRoot: string, url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${PET_PROTOCOL_SCHEME}:` || parsed.host !== PET_PROTOCOL_HOST) {
    return null
  }
  const segments = decodeURIComponent(parsed.pathname).split('/').filter(Boolean)
  // Either <packId>/<clipDir>/<frame> or <packId>/clips/<clipDir>/<frame>.
  if (segments.length !== 3 && segments.length !== 4) return null
  const [packId, ...rest] = segments
  const clipDir = rest.slice(0, -1).join('/')
  const frameFile = rest[rest.length - 1]
  if (!/^[\w-]+$/.test(packId) || !isSafeClipDir(clipDir) || !FRAME_NAME_PATTERN.test(frameFile)) {
    return null
  }
  const resolvedRoot = path.resolve(packRoot)
  const resolved = path.resolve(resolvedRoot, packId, clipDir, frameFile)
  if (!resolved.startsWith(resolvedRoot + path.sep)) return null
  return resolved
}

/** Attach the request handler to the default session (call after app ready). */
export function installPetProtocolHandler(packRoot: string): void {
  const root = path.resolve(packRoot)
  protocol.handle(PET_PROTOCOL_SCHEME, async (request) => {
    const filePath = resolvePetFramePath(root, request.url)
    if (!filePath) return new Response('not found', { status: 404 })
    try {
      const stat = await fsp.stat(filePath)
      if (!stat.isFile()) return new Response('not found', { status: 404 })
      const size = stat.size
      const stream = createReadStream(filePath)
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          stream.on('data', (chunk: string | Buffer) => {
            controller.enqueue(
              typeof chunk === 'string' ? new TextEncoder().encode(chunk) : new Uint8Array(chunk)
            )
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
          'content-type': 'image/webp',
          'content-length': String(size),
          'cache-control': 'no-store'
        }
      })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}

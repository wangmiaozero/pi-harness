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
const PREVIEW_NAME_PATTERN = /^[\w][\w.-]*\.(png|webp|jpe?g)$/

const CONTENT_TYPES: Record<string, string> = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg'
}

function contentTypeFor(file: string): string {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
}

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
 * Parse and validate a `pi-pet://petpack/<packId>/...` URL.
 *
 * Frame requests resolve to `<packRoot>/<packId>/<clipDir>/<frame>.webp`;
 * preview requests resolve to `<packRoot>/<packId>/<file>` (2 segments).
 * `packRoots` is searched in order (user packs first, then bundled packs).
 * Returns the absolute file path, or null for anything unexpected.
 */
export function resolvePetResourcePath(packRoots: string[], url: string): string | null {
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
  // <packId>/preview.png — or <packId>/<clipDir>/<frame> or <packId>/clips/<clipDir>/<frame>.
  if (segments.length < 2 || segments.length > 4) return null
  const [packId, ...rest] = segments
  const file = rest[rest.length - 1]
  if (!/^[\w-]+$/.test(packId)) return null
  const clipDir = rest.slice(0, -1).join('/')
  if (rest.length >= 2 && (!isSafeClipDir(clipDir) || !FRAME_NAME_PATTERN.test(file))) return null
  if (rest.length === 1 && !PREVIEW_NAME_PATTERN.test(file)) return null
  const relative = `${packId}/${rest.join('/')}`
  for (const packRoot of packRoots) {
    const resolvedRoot = path.resolve(packRoot)
    const resolved = path.resolve(resolvedRoot, relative)
    if (!resolved.startsWith(resolvedRoot + path.sep)) continue
    return resolved
  }
  return null
}

/**
 * Existence-aware multi-root resolution used by the protocol handler: walks
 * the roots in order (user packs first, bundled last) and returns the first
 * root that actually contains the requested regular file. Invalid URLs and
 * in-root escapes resolve to null immediately.
 */
export async function findExistingPetResource(packRoots: string[], url: string): Promise<string | null> {
  for (const packRoot of packRoots) {
    const resolvedRoot = path.resolve(packRoot)
    const candidate = resolvePetResourcePath([resolvedRoot], url)
    if (!candidate) {
      // Invalid URL or path escape: no root can ever serve it.
      if (packRoot === packRoots[0]) return null
      continue
    }
    try {
      const stat = await fsp.stat(candidate)
      if (stat.isFile()) return candidate
    } catch {
      // Fall through to the next root.
    }
  }
  return null
}

/** Attach the request handler to the default session (call after app ready). */
export function installPetProtocolHandler(packRoots: string[]): void {
  const roots = packRoots.map((root) => path.resolve(root))
  protocol.handle(PET_PROTOCOL_SCHEME, async (request) => {
    const filePath = await findExistingPetResource(roots, request.url)
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
          'content-type': contentTypeFor(filePath),
          'content-length': String(size),
          'cache-control': 'no-store'
        }
      })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}

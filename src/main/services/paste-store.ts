import fs from 'node:fs/promises'
import path from 'node:path'

import { AgentError } from './errors'

const MAX_FILE_BYTES = 25 * 1024 * 1024
const MAX_NAME_LENGTH = 120

export interface PastedFilePayload {
  name?: string
  mimeType?: string
  data: ArrayBuffer
}

export interface PastedFileRecord {
  path: string
  name: string
  kind: 'image' | 'text' | 'file'
}

/** Session-scoped directory that collects pasted files for the agent to read. */
export function pastedDirectory(userData: string, sessionId: string | null): string {
  const scope = sessionId && /^[\w.-]{1,128}$/.test(sessionId) ? sessionId : 'draft'
  return path.join(userData, 'pasted', scope)
}

function sanitizeName(raw: string | undefined, mimeType: string | undefined, index: number): string {
  const base = (raw ?? '')
    .replace(
      // eslint-disable-next-line no-control-regex -- clipboard names can carry control bytes
      /[\\/:*?"<>|\u0000-\u001f]/g,
      '_'
    )
    .replace(/^\.+/, '_')
    .replace(/\.\./g, '_')
    .trim()
    .slice(0, MAX_NAME_LENGTH)
  const fallback =
    mimeType === 'text/plain' ? `pasted-text-${index + 1}.txt` : `pasted-file-${index + 1}`
  const safe = base || fallback
  return `${Date.now()}-${safe}`
}

function classify(mimeType: string | undefined): PastedFileRecord['kind'] {
  if (mimeType?.startsWith('image/')) return 'image'
  if (mimeType === 'text/plain' || mimeType?.startsWith('text/')) return 'text'
  return 'file'
}

/** Accepts same-realm and cross-realm array buffers/views (structured clones, test realms). */
function toBytes(data: unknown): Uint8Array | undefined {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  }
  const tag = Object.prototype.toString.call(data)
  if (tag === '[object ArrayBuffer]' && typeof (data as ArrayBufferLike).byteLength === 'number') {
    return new Uint8Array(data as ArrayBuffer)
  }
  if (
    tag.endsWith('Array]') &&
    typeof (data as ArrayBufferView).byteLength === 'number' &&
    typeof (data as ArrayBufferView).byteOffset === 'number'
  ) {
    const view = data as ArrayBufferView
    return new Uint8Array(view.buffer as ArrayBuffer, view.byteOffset, view.byteLength)
  }
  return undefined
}

/**
 * Persist clipboard payloads into the session's temp directory so the agent
 * can read them from disk instead of inlining large content into the prompt.
 */
export async function savePastedFiles(
  userData: string,
  sessionId: string | null,
  files: PastedFilePayload[]
): Promise<PastedFileRecord[]> {
  if (!files.length) throw new AgentError('No pasted files to save')
  const directory = pastedDirectory(userData, sessionId)
  await fs.mkdir(directory, { recursive: true })
  const records: PastedFileRecord[] = []
  for (const [index, file] of files.entries()) {
    const bytes = toBytes(file.data)
    if (!bytes) throw new AgentError('Pasted file payload must be an ArrayBuffer')
    if (bytes.byteLength > MAX_FILE_BYTES) {
      throw new AgentError(`Pasted file ${index + 1} exceeds the 25MB limit`)
    }
    const name = sanitizeName(file.name, file.mimeType, index)
    const target = path.join(directory, name)
    if (!target.startsWith(directory + path.sep)) {
      throw new AgentError('Invalid pasted file name')
    }
    await fs.writeFile(target, bytes)
    records.push({ path: target, name, kind: classify(file.mimeType) })
  }
  return records
}

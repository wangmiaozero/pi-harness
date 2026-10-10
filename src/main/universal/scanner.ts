import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { createInterface } from 'node:readline'
import { createZstdDecompress } from 'node:zlib'
import { Transform } from 'node:stream'
import path from 'node:path'
import {
  type SourceLocation,
  type UniversalSession,
  type UniversalSyncStatus
} from '@shared/universal/schema'
import { atomicWriteText } from '../services/storage'
import { parseSession, hash, type ParsedSession } from './parsers'
import { object, string, array } from './normalize'
import { safeSourceFile, walk } from './sources'
import { parseSourceDatabase } from './sqlite'

// Invalidate derived blobs when format normalization changes; originals remain untouched.
const PARSER_REVISION = 3

export interface ScanRequest {
  sources: SourceLocation[]
  previous: UniversalSession[]
  storeRoot: string
}
export interface ScanResult {
  sessions: UniversalSession[]
  status: UniversalSyncStatus
}
export async function readRecords(
  file: string,
  options: { maxRecordBytes?: number; snapshotSize?: number } = {}
): Promise<{
  records: unknown[]
  warnings: string[]
  recordNumbers?: number[]
  sourceDigest?: string
}> {
  const records: unknown[] = []
  const warnings: string[] = []
  const recordNumbers: number[] = []
  const size = (await fs.stat(file)).size
  if (size > 256 * 1024 * 1024) throw new Error('SOURCE_SIZE_LIMIT')
  if (file.endsWith('.json')) {
    const value = object(JSON.parse(await fs.readFile(file, 'utf8')))
    return {
      records: value.messages
        ? [{ ...value, messages: undefined }, ...array(value.messages)]
        : [value],
      warnings
    }
  }
  const snapshotSize = options.snapshotSize ?? size
  if (!snapshotSize) throw new Error('SOURCE_FORMAT_ERROR')
  const maxRecordBytes = options.maxRecordBytes ?? 4 * 1024 * 1024
  // Read a finite prefix even when an active agent keeps appending to its transcript.
  const source = createReadStream(file, { highWaterMark: 64 * 1024, end: snapshotSize - 1 })
  const digest = createHash('sha256')
  source.on('data', (chunk: Buffer) => digest.update(chunk))
  const decoded = file.endsWith('.zst') ? source.pipe(createZstdDecompress()) : source
  let totalBytes = 0
  let lineBytes = 0
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      totalBytes += chunk.length
      if (totalBytes > 256 * 1024 * 1024) return done(new Error('SOURCE_SIZE_LIMIT'))
      for (const byte of chunk) {
        lineBytes = byte === 10 ? 0 : lineBytes + 1
        if (lineBytes > maxRecordBytes) return done(new Error('SOURCE_RECORD_SIZE_LIMIT'))
      }
      done(null, chunk)
    }
  })
  source.on('error', (error) => limiter.destroy(error))
  decoded.on('error', (error) => limiter.destroy(error))
  const stream = decoded.pipe(limiter)
  stream.setEncoding('utf8')
  const lines = createInterface({ input: stream, crlfDelay: Infinity })
  let lineNumber = 0
  try {
    for await (const line of lines) {
      lineNumber++
      if (lineNumber > 200_000) throw new Error('SOURCE_MESSAGE_LIMIT')
      if (!line.trim()) continue
      if (line.length > maxRecordBytes) throw new Error('SOURCE_RECORD_SIZE_LIMIT')
      try {
        records.push(JSON.parse(line))
        recordNumbers.push(lineNumber)
      } catch {
        warnings.push(`INVALID_RECORD:${lineNumber}`)
      }
      if (records.length > 200_000) throw new Error('SOURCE_MESSAGE_LIMIT')
    }
  } finally {
    lines.close()
    stream.destroy()
    decoded.destroy()
    source.destroy()
  }
  if (!records.length) throw new Error('SOURCE_FORMAT_ERROR')
  return { records, warnings, recordNumbers, sourceDigest: digest.digest('hex') }
}

async function prefixDigest(file: string, size: number): Promise<string> {
  const digest = createHash('sha256')
  let bytes = 0
  for await (const chunk of createReadStream(file, { end: size - 1 })) {
    bytes += chunk.length
    digest.update(chunk)
  }
  if (bytes !== size) throw new Error('SOURCE_CHANGED_DURING_READ')
  return digest.digest('hex')
}
function candidate(source: SourceLocation, file: string): boolean {
  const relative = path.relative(source.root, file).replaceAll(path.sep, '/')
  if (source.provider === 'cursor')
    return (
      relative === 'globalStorage/state.vscdb' ||
      /^workspaceStorage\/[^/]+\/state\.vscdb$/.test(relative)
    )
  if (source.provider === 'opencode')
    return relative === 'opencode.db' || /^storage\/session\/[^/]+\/[^/]+\.json$/.test(relative)
  if (source.provider === 'cursor-agent')
    return (
      (source.custom ||
        relative.includes('agent-transcripts/') ||
        path.basename(source.root) === 'agent-transcripts') &&
      file.endsWith('.jsonl')
    )
  if (source.provider === 'gemini')
    return (
      (source.custom || relative.includes('/chats/') || path.basename(source.root) === 'chats') &&
      /session-.*\.(json|jsonl)$/.test(path.basename(file))
    )
  return file.endsWith('.jsonl') || (source.provider === 'codex' && file.endsWith('.jsonl.zst'))
}
async function fileStamp(file: string): Promise<string> {
  const s = await fs.stat(file)
  return `${file}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`
}
async function legacyOpenCode(
  root: string,
  file: string,
  files: string[]
): Promise<{
  records: unknown[]
  projectPath?: string
  nativeId: string
  title?: string
  warnings: string[]
}> {
  let bytes = 0
  const readJson = async (target: string): Promise<unknown> => {
    await safeSourceFile(root, target)
    bytes += (await fs.stat(target)).size
    if (bytes > 256 * 1024 * 1024) throw new Error('SOURCE_SIZE_LIMIT')
    return JSON.parse(await fs.readFile(target, 'utf8'))
  }
  const header = object(await readJson(file))
  const nativeId = string(header.id) ?? ''
  if (!/^[\w-]+$/.test(nativeId)) throw new Error('OPENCODE_SESSION_ID_ERROR')
  const records: unknown[] = []
  const warnings: string[] = []
  for (const f of files.filter(
    (f) => path.dirname(f) === path.join(root, 'storage', 'message', nativeId)
  )) {
    await safeSourceFile(root, f)
    const m = object(await readJson(f))
    const messageId = string(m.id)
    if (!messageId || !/^[\w-]+$/.test(messageId)) {
      warnings.push('OPENCODE_MESSAGE_ID_ERROR')
      continue
    }
    const parts: unknown[] = []
    for (const p of files.filter(
      (f) => path.dirname(f) === path.join(root, 'storage', 'part', messageId)
    )) {
      await safeSourceFile(root, p)
      parts.push(await readJson(p))
    }
    records.push({ ...m, parts })
  }
  records.sort(
    (a, b) =>
      Number(object(object(a).time).created ?? 0) - Number(object(object(b).time).created ?? 0)
  )
  return {
    records,
    nativeId,
    projectPath: string(header.directory),
    title: string(header.title),
    warnings
  }
}
export async function scanSources(
  request: ScanRequest,
  signal?: AbortSignal,
  progress?: (status: UniversalSyncStatus) => void
): Promise<ScanResult> {
  const status: UniversalSyncStatus = {
    running: true,
    cancelled: false,
    scanned: 0,
    changed: 0,
    errors: []
  }
  const output = new Map<string, UniversalSession>()
  const previousByFile = new Map<string, UniversalSession[]>()
  for (const s of request.previous) {
    const key = `${s.provider}:${s.source.path}`
    previousByFile.set(key, [...(previousByFile.get(key) ?? []), s])
  }
  for (const source of request.sources) {
    signal?.throwIfAborted()
    try {
      const files = (await walk(source.root, signal)).filter(
        (f) => !/\.(?:bak|backup|tmp)$/.test(f)
      )
      // A legacy session's parts are independent files, so their changes invalidate the session too.
      const legacyStamp =
        source.provider === 'opencode'
          ? (await Promise.all(files.filter((f) => f.endsWith('.json')).map(fileStamp))).join('\n')
          : ''
      for (const file of files
        .filter((f) => candidate(source, f))
        .sort((a, b) => {
          const priority = (file: string) =>
            file.endsWith('.db') || file.endsWith('globalStorage/state.vscdb') ? 0 : 1
          return priority(a) - priority(b)
        })) {
        signal?.throwIfAborted()
        status.scanned++
        try {
          await safeSourceFile(source.root, file)
          const st = await fs.stat(file)
          const stamp = `${file}:${st.size}:${st.mtimeMs}:${st.ctimeMs}`
          const wal = await fileStamp(`${file}-wal`).catch(() => '')
          const metadata =
            source.provider === 'cursor'
              ? (
                  await Promise.all(
                    files.filter((f) => path.basename(f) === 'workspace.json').map(fileStamp)
                  )
                ).join('\n')
              : source.provider === 'gemini'
                ? await fileStamp(
                    path.join(path.dirname(path.dirname(file)), '.project_root')
                  ).catch(() => '')
                : ''
          const fingerprint = hash(
            `${PARSER_REVISION}\n${stamp}\n${wal}\n${metadata}\n${file.endsWith('.json') && source.provider === 'opencode' ? legacyStamp : ''}`
          )
          const previous = previousByFile.get(`${source.provider}:${file}`) ?? []
          if (
            previous.length &&
            previous.every(
              (s) => s.source.fingerprint === fingerprint && s.source.status === 'available'
            )
          ) {
            previous.forEach((s) => {
              if (!output.has(s.id)) output.set(s.id, s)
            })
            continue
          }
          const base = {
            provider: source.provider,
            file,
            root: source.root,
            fingerprint,
            mtime: st.mtime.toISOString()
          }
          let parsed: ParsedSession[]
          let sourceDigest: string | undefined
          if (source.provider === 'cursor' || file.endsWith('.db')) {
            parsed = await parseSourceDatabase(base, request.storeRoot)
          } else {
            const data =
              source.provider === 'opencode'
                ? await legacyOpenCode(source.root, file, files)
                : await readRecords(file, {
                    snapshotSize: st.size,
                    // Desktop image/tool records can exceed 4 MiB. Keep a bounded larger limit.
                    maxRecordBytes: source.provider === 'codex' ? 16 * 1024 * 1024 : undefined
                  })
            sourceDigest = 'sourceDigest' in data ? data.sourceDigest : undefined
            let projectPath: string | undefined
            if (source.provider === 'gemini') {
              const rootFile = path.join(path.dirname(path.dirname(file)), '.project_root')
              try {
                await safeSourceFile(source.root, rootFile)
                projectPath = (await fs.readFile(rootFile, 'utf8')).trim()
              } catch {
                /* mapping remains explicit */
              }
            }
            if (source.provider === 'cursor-agent') {
              const firstText = array(object(object(data.records[0]).message).content)
                .map((x) => string(object(x).text) ?? '')
                .join('\n')
              const cwd = firstText.match(
                /<(?:cwd|workspace_path)>([^<]+)<\/(?:cwd|workspace_path)>/
              )
              projectPath = cwd?.[1]
            }
            parsed = [parseSession({ ...base, projectPath, ...data })]
          }
          const latest = await fs.stat(file)
          const unchanged = `${file}:${latest.size}:${latest.mtimeMs}:${latest.ctimeMs}` === stamp
          const appended =
            !unchanged &&
            source.provider === 'codex' &&
            file.endsWith('.jsonl') &&
            latest.ino === st.ino &&
            latest.dev === st.dev &&
            latest.size > st.size &&
            sourceDigest !== undefined &&
            (await prefixDigest(file, st.size)) === sourceDigest
          // Only verified append-only growth is safe; replacements/rewrites retry next sync.
          if ((!unchanged && !appended) || (await fileStamp(`${file}-wal`).catch(() => '')) !== wal)
            throw new Error('SOURCE_CHANGED_DURING_READ')
          for (const p of parsed) {
            if (appended) p.session.warnings.push('SOURCE_APPENDED_DURING_READ')
            const prior = request.previous.find((s) => s.id === p.session.id)
            if (prior?.workspacePath) {
              p.session.workspacePath = prior.workspacePath
              p.session.workspaceRoots = prior.workspaceRoots
            }
            if (
              output.has(p.session.id) &&
              (file.endsWith('.json') || source.provider === 'cursor')
            )
              continue // Current SQLite bodies win over migrated legacy copies/headers.
            await persistParsed(request.storeRoot, p)
            output.set(p.session.id, p.session)
            status.changed++
          }
        } catch (e) {
          const code = safeCode(e)
          status.errors.push({ provider: source.provider, code })
          for (const old of previousByFile.get(`${source.provider}:${file}`) ?? [])
            output.set(old.id, {
              ...old,
              source: { ...old.source, status: 'error' },
              warnings: [...new Set([...old.warnings, code])]
            })
        }
        progress?.({ ...status })
      }
    } catch (e) {
      if (signal?.aborted) throw e
      status.errors.push({ provider: source.provider, code: safeCode(e) })
      for (const old of request.previous.filter(
        (s) => s.provider === source.provider && s.source.root === source.root
      ))
        output.set(old.id, {
          ...old,
          source: { ...old.source, status: safeCode(e) === 'SOURCE_MISSING' ? 'missing' : 'error' }
        })
    }
  }
  for (const old of request.previous)
    if (!output.has(old.id))
      output.set(old.id, { ...old, source: { ...old.source, status: 'missing' } })
  status.running = false
  status.lastSync = new Date().toISOString()
  return { sessions: [...output.values()], status }
}
export async function persistParsed(root: string, parsed: ParsedSession): Promise<void> {
  const blob = path.join(root, 'messages', `${parsed.session.blob}.jsonl`)
  await atomicWriteText(blob, parsed.messages.map((m) => JSON.stringify(m)).join('\n') + '\n')
  await atomicWriteText(
    path.join(root, 'search', `${parsed.session.blob}.txt`),
    parsed.messages
      .flatMap((m) =>
        m.parts.flatMap((p) =>
          'text' in p ? [p.text] : p.type === 'tool-call' ? [p.name, p.input] : []
        )
      )
      .join('\n')
      .toLowerCase()
  )
}
export function safeCode(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  return /^[A-Z_]+$/.test(message)
    ? message
    : (error as NodeJS.ErrnoException)?.code === 'ENOENT'
      ? 'SOURCE_MISSING'
      : 'SOURCE_PARSE_ERROR'
}

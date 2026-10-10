/** Read-only ports of CCHV's Cursor/OpenCode query and reconstruction logic (MIT). */
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { safeSourceFile } from './sources'
import { object, array, string, iso } from './normalize'
import { parseSession, hash, type ParseInput, type ParsedSession } from './parsers'

function json(value: unknown): Record<string, unknown> {
  const text = value instanceof Uint8Array ? Buffer.from(value).toString('utf8') : String(value)
  return object(JSON.parse(text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')))
}
export async function parseDatabase(input: Omit<ParseInput, 'records'>): Promise<ParsedSession[]> {
  const db = new DatabaseSync(input.file, { readOnly: true, timeout: 1000 })
  const result: ParsedSession[] = []
  try {
    // A short read transaction sees WAL content consistently; no immutable=1 stale reads.
    db.exec('PRAGMA query_only = ON; BEGIN')
    if (input.provider === 'opencode') {
      const sessions = db
        .prepare('SELECT id, title, directory, time_created, time_updated FROM session')
        .all()
      const messages = db.prepare(
        'SELECT id, data FROM message WHERE session_id = ? ORDER BY time_created, id'
      )
      const parts = db.prepare('SELECT data FROM part WHERE message_id = ? ORDER BY id')
      for (const session of sessions) {
        const records = messages.all(session.id!).map((m) => ({
          ...json(m.data),
          id: m.id,
          parts: parts.all(m.id!).map((p) => json(p.data))
        }))
        const parsed = parseSession({
          ...input,
          nativeId: String(session.id),
          title: string(session.title),
          projectPath: string(session.directory),
          records
        })
        parsed.session.createdAt = iso(session.time_created) ?? parsed.session.createdAt
        parsed.session.updatedAt = iso(session.time_updated) ?? parsed.session.updatedAt
        result.push(parsed)
      }
    } else {
      const hasKv = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'cursorDiskKV'")
        .get()
      if (!hasKv) {
        const hasItems = db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ItemTable'")
          .get()
        if (!hasItems) throw new Error('CURSOR_FORMAT_ERROR')
        const row = db
          .prepare("SELECT value FROM ItemTable WHERE key = 'composer.composerData'")
          .get()
        if (!row) return []
        const workspaceId = path.basename(path.dirname(input.file))
        const projectPath = await cursorWorkspacePath(input.root, workspaceId)
        for (const raw of array(json(row.value).allComposers)) {
          const c = object(raw)
          const nativeId = string(c.composerId)
          if (!nativeId) continue
          result.push(
            parseSession({
              ...input,
              nativeId,
              title: string(c.name),
              projectPath,
              records: array(c.conversation),
              warnings: ['CURSOR_LEGACY_HEADERS_ONLY']
            })
          )
        }
        return result
      }
      const composers = db
        .prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'")
        .all()
      const bubbles = db.prepare('SELECT key, value FROM cursorDiskKV WHERE key LIKE ?')
      for (const row of composers) {
        try {
          const c = json(row.value)
          const nativeId = String(row.key).slice('composerData:'.length)
          const prefix = `bubbleId:${nativeId}:`
          const byId = new Map(
            bubbles
              .all(`${prefix}%`)
              .map((b) => [String(b.key).slice(prefix.length), json(b.value)])
          )
          const headers = array(c.fullConversationHeadersOnly)
          const warnings: string[] = []
          const records = headers.flatMap((h) => {
            const header = object(h)
            const bubbleId = string(header.bubbleId) ?? ''
            const bubble = byId.get(bubbleId)
            if (!bubble) {
              warnings.push('CURSOR_BUBBLE_MISSING')
              return []
            }
            return [{ ...bubble, bubbleId, type: header.type ?? bubble.type }]
          })
          const uri = object(object(c.workspaceIdentifier).uri)
          let projectPath = string(uri.fsPath ?? uri.path)
          if (!projectPath)
            projectPath = await cursorWorkspacePath(
              input.root,
              string(object(c.workspaceIdentifier).id)
            )
          const parsed = parseSession({
            ...input,
            nativeId,
            title: string(c.name),
            projectPath,
            records,
            warnings
          })
          const tokenCount = object(c.promptTokenBreakdown).totalUsedTokens
          if (typeof tokenCount === 'number') parsed.session.metadata.tokens = tokenCount
          parsed.session.createdAt = iso(c.createdAt) ?? parsed.session.createdAt
          parsed.session.updatedAt = iso(c.lastUpdatedAt) ?? parsed.session.updatedAt
          result.push(parsed)
        } catch {
          throw new Error('CURSOR_FORMAT_ERROR')
        }
      }
    }
    return result
  } finally {
    db.close()
  }
}
async function cursorWorkspacePath(
  root: string,
  workspaceId?: string
): Promise<string | undefined> {
  if (!workspaceId || !/^[\w-]+$/.test(workspaceId)) return undefined
  const file = path.join(root, 'workspaceStorage', workspaceId, 'workspace.json')
  try {
    await safeSourceFile(root, file)
    const value = object(JSON.parse(await fs.readFile(file, 'utf8')))
    const uri = string(value.folder)
    return uri?.startsWith('file:') ? fileURLToPath(uri) : undefined
  } catch {
    return undefined
  }
}

/** SQLite can create shared-memory files even on a read-only connection. Query only our copy. */
export async function parseSourceDatabase(
  input: Omit<ParseInput, 'records'>,
  storeRoot: string
): Promise<ParsedSession[]> {
  const parent = path.join(storeRoot, 'snapshots')
  await fs.mkdir(parent, { recursive: true, mode: 0o700 })
  const snapshot = await fs.mkdtemp(path.join(parent, 'sqlite-'))
  const directory = path.join(snapshot, path.basename(path.dirname(input.file)))
  await fs.mkdir(directory)
  const database = path.join(directory, path.basename(input.file))
  const stamp = async (file: string) => {
    const st = await fs.stat(file)
    return `${st.size}:${st.mtimeMs}:${st.ctimeMs}`
  }
  try {
    await safeSourceFile(input.root, input.file)
    const before = await stamp(input.file)
    const wal = `${input.file}-wal`
    const walBefore = await stamp(wal).catch(() => undefined)
    await fs.copyFile(input.file, database)
    if (walBefore !== undefined) {
      await safeSourceFile(input.root, wal)
      await fs.copyFile(wal, `${database}-wal`)
    }
    if (
      before !== (await stamp(input.file)) ||
      walBefore !== (await stamp(wal).catch(() => undefined))
    )
      throw new Error('SOURCE_CHANGED_DURING_READ')
    // Retain original source references and workspace metadata despite querying a cache copy.
    const parsed = await parseDatabase({ ...input, file: database })
    for (const p of parsed) {
      p.session.source.path = input.file
      for (const message of p.messages)
        message.sourceRef = message.sourceRef.replace(database, input.file)
      // References are part of the immutable blob identity.
      p.session.blob = hash(JSON.stringify(p.messages))
    }
    return parsed
  } finally {
    await fs.rm(snapshot, { recursive: true, force: true })
  }
}

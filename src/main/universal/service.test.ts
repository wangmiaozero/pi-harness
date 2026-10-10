import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { zstdCompressSync } from 'node:zlib'
import { UniversalSessionService } from './service'
import { scanSources, readRecords } from './scanner'
import { parseDatabase, parseSourceDatabase } from './sqlite'
import { hash } from './parsers'
import { defaultSources, safeSourceFile, existingSources } from './sources'
import type { SourceLocation } from '@shared/universal/schema'

describe('local history discovery, persistence and isolation', () => {
  let root: string
  let service: UniversalSessionService
  let source: SourceLocation
  let file: string
  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'universal-test-')))
    source = { provider: 'claude', root: path.join(root, 'source'), custom: false }
    await fs.mkdir(source.root)
    file = path.join(source.root, 'session.jsonl')
    await fs.writeFile(
      file,
      JSON.stringify({
        type: 'user',
        sessionId: 's1',
        uuid: 'u1',
        cwd: '/project/a',
        message: { role: 'user', content: '中文 history' }
      }) + '\n'
    )
    service = new UniversalSessionService(path.join(root, 'cache'), [source], (request, progress) =>
      scanSources(request, undefined, progress)
    )
  })
  afterEach(async () => {
    await service.close()
    await fs.rm(root, { recursive: true, force: true })
  })
  it('discovers, syncs, searches and pages without any model service', async () => {
    expect(await service.sources()).toEqual([source])
    const first = await service.sync()
    expect(first.changed).toBe(1)
    const result = await service.list({ query: '中文' })
    expect(result.total).toBe(1)
    const id = result.sessions[0]!.id
    const detail = await service.read({ id, limit: 1 })
    expect(detail.messages[0]?.parts[0]).toMatchObject({ type: 'text', text: '中文 history' })
    expect((await service.sync()).changed).toBe(0)
    expect((await service.list({ projectPath: '/different' })).total).toBe(0)
    expect((await service.list({ projectPath: '/different' })).projects).toContain('/project/a')
  })
  it('updates appended/truncated files idempotently and restores the same revision after restart', async () => {
    await service.sync()
    await fs.appendFile(
      file,
      JSON.stringify({
        type: 'assistant',
        uuid: 'a1',
        message: { role: 'assistant', content: 'keyword remains' }
      }) + '\n{"truncated":'
    )
    const synced = await service.sync()
    expect(synced.changed).toBe(1)
    const { sessions } = await service.list({ query: 'remains' })
    expect(sessions[0]?.messageCount).toBe(2)
    expect(sessions[0]?.warnings).toContain('INVALID_RECORD:3')
    await service.close()
    service = new UniversalSessionService(path.join(root, 'cache'), [source], (request, progress) =>
      scanSources(request, undefined, progress)
    )
    expect((await service.list()).sessions[0]?.blob).toBe(sessions[0]?.blob)
    expect((await service.sync()).changed).toBe(0)
  })
  it('isolates malformed providers and visibly marks removed sources', async () => {
    const bad: SourceLocation = { provider: 'codex', root: path.join(root, 'bad'), custom: true }
    await fs.mkdir(bad.root)
    await fs.writeFile(path.join(bad.root, 'bad.jsonl'), 'broken')
    await service.addSource(bad.provider, bad.root)
    expect((await service.sync()).errors).toContainEqual({
      provider: 'codex',
      code: 'SOURCE_FORMAT_ERROR'
    })
    expect((await service.list()).total).toBe(1)
    await fs.unlink(file)
    await service.sync()
    expect((await service.list()).sessions[0]?.source.status).toBe('missing')
  })
  it('keeps exact JSONL line evidence after a malformed middle record', async () => {
    await fs.appendFile(
      file,
      '\ninvalid\n' +
        JSON.stringify({
          type: 'assistant',
          message: { role: 'assistant', content: 'after invalid' }
        })
    )
    await service.sync()
    const id = (await service.list()).sessions[0]!.id
    const detail = await service.read({ id })
    expect(detail.session.warnings).toContain('INVALID_RECORD:3')
    expect(detail.messages[1]?.sourceRef).toContain('#record=4')
  })
  it('cleans crash-orphaned blobs on restart and recovers unsupported cache versions by explicit clearing', async () => {
    await service.sync()
    await service.close()
    const orphan = path.join(root, 'cache', 'messages', `${hash('orphan')}.jsonl`)
    await fs.writeFile(orphan, 'orphan')
    service = new UniversalSessionService(path.join(root, 'cache'), [source], (request) =>
      scanSources(request)
    )
    expect((await service.list()).total).toBe(1)
    await expect(fs.stat(orphan)).rejects.toThrow()
    await service.close()
    await fs.writeFile(path.join(root, 'cache', 'index.json'), '{"schemaVersion":999}')
    service = new UniversalSessionService(path.join(root, 'cache'), [source], (request) =>
      scanSources(request)
    )
    await expect(service.list()).rejects.toThrow('unsupported')
    await service.clear()
    expect((await service.sync()).changed).toBe(1)
  })
  it('never alters original sessions when clearing/forgetting derived data', async () => {
    const original = await fs.readFile(file)
    const stat = await fs.stat(file)
    await service.sync()
    const id = (await service.list()).sessions[0]!.id
    await service.forget(id)
    expect((await service.list()).total).toBe(0)
    await service.sync()
    await service.clear()
    expect(await fs.readFile(file)).toEqual(original)
    expect((await fs.stat(file)).mtimeMs).toBe(stat.mtimeMs)
    expect(await fs.readdir(path.join(root, 'cache', 'messages'))).toHaveLength(0)
  })
  it('ignores symlinks and rejects source traversal and oversized IPC pages', async () => {
    const outside = path.join(root, 'outside.jsonl')
    await fs.writeFile(outside, 'secret')
    await fs.symlink(outside, path.join(source.root, 'linked.jsonl'))
    await expect(safeSourceFile(source.root, outside)).rejects.toThrow('SOURCE_PATH_DENIED')
    await expect(
      safeSourceFile(source.root, path.join(source.root, 'linked.jsonl'))
    ).rejects.toThrow('SOURCE_PATH_DENIED')
    await service.sync()
    expect((await service.list()).total).toBe(1)
    await expect(service.read({ id: '../outside', limit: 1000 })).rejects.toThrow()
    await expect(service.list({ query: 'x', unexpected: true } as never)).rejects.toThrow()
  })
  it('reads large JSONL incrementally and tolerates incomplete final records', async () => {
    const big = path.join(source.root, 'large.jsonl')
    await fs.writeFile(
      big,
      Array.from({ length: 12_000 }, (_, i) =>
        JSON.stringify({
          type: 'user',
          uuid: `u-${i}`,
          message: { role: 'user', content: `消息 ${i}` }
        })
      ).join('\n') + '\n{"partial"'
    )
    const result = await readRecords(big)
    expect(result.records).toHaveLength(12_000)
    expect(result.warnings).toEqual(['INVALID_RECORD:12001'])
    await service.sync()
    const session = (await service.list()).sessions.find((s) => s.messageCount === 12_000)!
    expect(
      (await service.read({ id: session.id, offset: 11_990, limit: 10 })).messages
    ).toHaveLength(10)
  })
  it('cancels publication of a running scan and leaves the committed index usable', async () => {
    await service.sync()
    await service.close()
    let resolve: (r: Awaited<ReturnType<typeof scanSources>>) => void = () => undefined
    const started = vi.fn()
    service = new UniversalSessionService(
      path.join(root, 'cache'),
      [source],
      (request) =>
        new Promise((r) => {
          resolve = r
          started(request)
        })
    )
    const scanning = service.sync()
    await vi.waitFor(() => expect(started).toHaveBeenCalled())
    const cancel = service.cancelSync()
    resolve({
      sessions: [],
      status: { running: false, cancelled: false, scanned: 0, changed: 0, errors: [] }
    })
    await cancel
    await scanning
    expect((await service.status()).cancelled).toBe(true)
    expect((await service.list()).total).toBe(1)
  })
  it('persists opt-in watching and refreshes appended history after the debounce', async () => {
    await service.sync()
    await service.setWatch(true)
    const watcher = (
      service as unknown as { watcher: { once(event: string, fn: () => void): void } }
    ).watcher
    await new Promise<void>((resolve) => watcher.once('ready', resolve))
    await fs.appendFile(
      file,
      JSON.stringify({
        type: 'assistant',
        uuid: 'watched',
        message: { role: 'assistant', content: 'watch appended' }
      }) + '\n'
    )
    await vi.waitFor(
      async () => expect((await service.list({ query: 'watch appended' })).total).toBe(1),
      { timeout: 10_000, interval: 100 }
    )
    expect((await service.status()).watchEnabled).toBe(true)
    await service.setWatch(false)
    expect((await service.status()).watchEnabled).toBe(false)
  }, 15_000)
  it('builds platform paths and does not create missing tool directories', async () => {
    expect(
      defaultSources('/home/user', 'linux', {}).find((s) => s.provider === 'cursor')?.root
    ).toBe('/home/user/.config/Cursor/User')
    expect(
      defaultSources('/home/user', 'darwin', {}).find((s) => s.provider === 'cursor')?.root
    ).toContain('Library/Application Support')
    expect(
      defaultSources('/home/user', 'win32', { APPDATA: '/roaming' }).find(
        (s) => s.provider === 'cursor'
      )?.root
    ).toBe('/roaming/Cursor/User')
    const missing = path.join(root, 'missing')
    expect(await existingSources([{ provider: 'pi', root: missing, custom: false }])).toEqual([])
    await expect(fs.stat(missing)).rejects.toThrow()
  })
  it('reads Codex zstd archives and legacy Gemini JSON files', async () => {
    const archive = path.join(root, 'archive.jsonl.zst')
    await fs.writeFile(
      archive,
      zstdCompressSync(
        Buffer.from(
          '{"type":"session_meta","payload":{"id":"zstd-session","cwd":"/project"}}\n{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"archive"}]}}\n'
        )
      )
    )
    expect((await readRecords(archive)).records).toHaveLength(2)
    const legacy = path.join(root, 'session-gemini.json')
    await fs.writeFile(
      legacy,
      JSON.stringify({
        sessionId: 'legacy',
        projectHash: 'hash',
        messages: [{ id: 'm1', type: 'user', content: 'legacy' }]
      })
    )
    expect((await readRecords(legacy)).records).toHaveLength(2)
  })
  it('rejects corrupt compression and oversized records without crashing the scanner', async () => {
    const corrupt = path.join(root, 'corrupt.jsonl.zst')
    await fs.writeFile(corrupt, 'invalid compressed stream')
    await expect(readRecords(corrupt)).rejects.toThrow()
    const huge = path.join(root, 'huge.jsonl')
    await fs.writeFile(huge, 'x'.repeat(4 * 1024 * 1024 + 1))
    await expect(readRecords(huge)).rejects.toThrow('SOURCE_RECORD_SIZE_LIMIT')
  })
  it('rebuilds legacy OpenCode when a message part changes independently', async () => {
    const opencode = path.join(root, 'opencode')
    const locations = ['storage/session/project', 'storage/message/s1', 'storage/part/m1']
    for (const location of locations)
      await fs.mkdir(path.join(opencode, location), { recursive: true })
    await fs.writeFile(
      path.join(opencode, locations[0]!, 's1.json'),
      JSON.stringify({ id: 's1', title: 'Legacy OpenCode', directory: '/project' })
    )
    await fs.writeFile(
      path.join(opencode, locations[1]!, 'm1.json'),
      JSON.stringify({ id: 'm1', role: 'assistant', modelID: 'model-1' })
    )
    const part = path.join(opencode, locations[2]!, 'p1.json')
    await fs.writeFile(part, JSON.stringify({ type: 'text', text: 'original part' }))
    await service.addSource('opencode', opencode)
    await service.sync()
    expect((await service.list({ query: 'original part' })).total).toBe(1)
    await fs.writeFile(part, JSON.stringify({ type: 'text', text: 'updated part' }))
    expect((await service.sync()).changed).toBe(1)
    expect((await service.list({ query: 'updated part' })).total).toBe(1)
  })
  it('persists project source mappings across incremental scans and accepts only directories', async () => {
    await service.sync()
    const project = path.join(root, 'project')
    const reference = path.join(root, 'reference')
    await fs.mkdir(project)
    await fs.mkdir(reference)
    const id = (await service.list()).sessions[0]!.id
    await service.map(id, project, [project, reference, project])
    await fs.appendFile(
      file,
      '\n' +
        JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'updated' } })
    )
    await service.sync()
    expect((await service.get(id)).workspaceRoots).toEqual([project, reference])
    expect((await service.list({ projectPath: reference })).total).toBe(1)
    await expect(service.map(id, file)).rejects.toThrow('project directory')
    await service.close()
    service = new UniversalSessionService(path.join(root, 'cache'), [source], (request) =>
      scanSources(request)
    )
    expect((await service.get(id)).workspaceRoots).toEqual([project, reference])
  })
  it('starts watching newly discovered directories and cancels pending refreshes when watching is disabled', async () => {
    await service.close()
    const late: SourceLocation = {
      provider: 'claude',
      root: path.join(root, 'late'),
      custom: false
    }
    service = new UniversalSessionService(
      path.join(root, 'cache'),
      [source, late],
      (request, progress) => scanSources(request, undefined, progress)
    )
    await service.sync()
    await service.setWatch(true)
    await fs.mkdir(late.root)
    const log = path.join(late.root, 'late.jsonl')
    const row = (uuid: string, content: string) =>
      JSON.stringify({
        type: 'user',
        sessionId: 'late',
        uuid,
        message: { role: 'user', content }
      }) + '\n'
    await fs.writeFile(log, row('u1', 'late source'))
    await service.sync()
    const watcher = (
      service as unknown as { watcher: { once(event: string, fn: () => void): void } }
    ).watcher
    await new Promise<void>((resolve) => watcher.once('ready', resolve))
    await fs.appendFile(log, row('u2', 'new directory watched'))
    await vi.waitFor(
      async () => expect((await service.list({ query: 'new directory watched' })).total).toBe(1),
      { timeout: 10_000, interval: 100 }
    )
    const changed = new Promise<void>((resolve) => watcher.once('all', resolve))
    await fs.appendFile(log, row('u3', 'disabled pending refresh'))
    await changed
    await service.setWatch(false)
    await new Promise((resolve) => setTimeout(resolve, 3000))
    expect((await service.list({ query: 'disabled pending refresh' })).total).toBe(0)
  }, 20_000)
})

describe('real SQLite provider stores', () => {
  let root: string
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'universal-sqlite-'))
  })
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })
  it('reads Cursor composer/bubble joins and pending WAL data without changing the DB', async () => {
    const file = path.join(root, 'state.vscdb')
    const writer = new DatabaseSync(file)
    writer.exec(
      'PRAGMA journal_mode=WAL; CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT)'
    )
    const put = writer.prepare('INSERT INTO cursorDiskKV VALUES (?, ?)')
    put.run(
      'composerData:composer-1',
      JSON.stringify({
        composerId: 'composer-1',
        name: 'Cursor任务',
        workspaceIdentifier: { id: 'ws', uri: { fsPath: '/project' } },
        fullConversationHeadersOnly: [
          { bubbleId: 'u', type: 1 },
          { bubbleId: 'a', type: 2 }
        ],
        promptTokenBreakdown: { totalUsedTokens: 45 }
      })
    )
    put.run(
      'bubbleId:composer-1:u',
      JSON.stringify({ bubbleId: 'u', text: '修复代码', createdAt: 1000 })
    )
    put.run(
      'bubbleId:composer-1:a',
      JSON.stringify({
        bubbleId: 'a',
        text: 'done',
        toolFormerData: {
          name: 'edit_file',
          toolCallId: 'tool-1',
          rawArgs: '{"file_path":"a.ts"}',
          status: 'completed'
        }
      })
    )
    const before = await fs.readFile(file)
    try {
      const parsed = await parseDatabase({
        provider: 'cursor',
        file,
        root,
        fingerprint: hash('db'),
        mtime: new Date().toISOString()
      })
      expect(parsed).toHaveLength(1)
      expect(parsed[0]?.messages).toHaveLength(2)
      expect(parsed[0]?.session.metadata.tokens).toBe(45)
      expect(parsed[0]?.session.projectPath).toBe('/project')
      expect(parsed[0]?.messages[1]?.parts[0]).toMatchObject({
        type: 'tool-call',
        callId: 'tool-1'
      })
      expect(await fs.readFile(file)).toEqual(before)
      expect(writer.prepare('SELECT COUNT(*) AS count FROM cursorDiskKV').get()?.count).toBe(3)
    } finally {
      writer.close()
    }
  })
  it('reads OpenCode SQL sessions, messages and parts with real field names', async () => {
    const file = path.join(root, 'opencode.db')
    const db = new DatabaseSync(file)
    db.exec(
      'CREATE TABLE session(id TEXT, title TEXT, directory TEXT, time_created INTEGER, time_updated INTEGER); CREATE TABLE message(id TEXT, session_id TEXT, data TEXT, time_created INTEGER); CREATE TABLE part(id TEXT, message_id TEXT, data TEXT)'
    )
    db.prepare('INSERT INTO session VALUES(?,?,?,?,?)').run(
      's1',
      'OpenCode task',
      '/project',
      1000,
      2000
    )
    db.prepare('INSERT INTO message VALUES(?,?,?,?)').run(
      'm1',
      's1',
      JSON.stringify({ id: 'm1', role: 'assistant', modelID: 'm', time: { created: 1000 } }),
      1000
    )
    db.prepare('INSERT INTO part VALUES(?,?,?)').run(
      'p1',
      'm1',
      JSON.stringify({
        type: 'tool',
        tool: 'read',
        callID: 't1',
        state: { input: { filePath: 'a.ts' }, output: 'contents', status: 'completed' }
      })
    )
    db.close()
    const parsed = await parseDatabase({
      provider: 'opencode',
      file,
      root,
      fingerprint: hash('db'),
      mtime: new Date().toISOString()
    })
    expect(parsed[0]?.session.title).toBe('OpenCode task')
    expect(parsed[0]?.messages[0]?.parts[1]).toMatchObject({
      type: 'tool-result',
      text: 'contents'
    })
  })
  it('queries a cache snapshot without creating WAL shared-memory files beside the original', async () => {
    const file = path.join(root, 'state.vscdb')
    const writer = new DatabaseSync(file)
    writer.exec(
      'PRAGMA journal_mode=WAL; CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT)'
    )
    writer
      .prepare('INSERT INTO cursorDiskKV VALUES (?, ?)')
      .run(
        'composerData:c',
        JSON.stringify({ fullConversationHeadersOnly: [{ bubbleId: 'b', type: 1 }] })
      )
    writer
      .prepare('INSERT INTO cursorDiskKV VALUES (?, ?)')
      .run('bubbleId:c:b', JSON.stringify({ text: 'pending WAL' }))
    // Preserve a hot WAL database after closing the writer, with no original SHM file.
    const databaseBytes = await fs.readFile(file)
    const walBytes = await fs.readFile(`${file}-wal`)
    writer.close()
    await fs.writeFile(file, databaseBytes)
    await fs.writeFile(`${file}-wal`, walBytes)
    const before = await fs.readdir(root)
    const cache = path.join(root, 'cache')
    const parsed = await parseSourceDatabase(
      {
        provider: 'cursor',
        file,
        root,
        fingerprint: hash('snapshot'),
        mtime: new Date().toISOString()
      },
      cache
    )
    expect(parsed[0]?.messages[0]?.parts[0]).toMatchObject({ text: 'pending WAL' })
    expect(parsed[0]?.messages[0]?.sourceRef).toContain(file)
    expect((await fs.readdir(root)).filter((f) => f !== 'cache')).toEqual(before)
    expect(await fs.readFile(file)).toEqual(databaseBytes)
    expect(await fs.readFile(`${file}-wal`)).toEqual(walBytes)
    expect(await fs.readdir(path.join(cache, 'snapshots'))).toEqual([])
  })
  it('keeps legacy Cursor metadata visible without inventing missing bubble text', async () => {
    const workspace = path.join(root, 'workspaceStorage', 'ws-id')
    await fs.mkdir(workspace, { recursive: true })
    await fs.writeFile(
      path.join(workspace, 'workspace.json'),
      JSON.stringify({ folder: 'file:///project/cursor' })
    )
    const file = path.join(workspace, 'state.vscdb')
    const db = new DatabaseSync(file)
    db.exec('CREATE TABLE ItemTable(key TEXT, value TEXT)')
    db.prepare('INSERT INTO ItemTable VALUES (?, ?)').run(
      'composer.composerData',
      JSON.stringify({ allComposers: [{ composerId: 'legacy', name: 'Original name' }] })
    )
    db.close()
    const parsed = await parseSourceDatabase(
      {
        provider: 'cursor',
        file,
        root,
        fingerprint: hash('legacy-cursor'),
        mtime: new Date().toISOString()
      },
      path.join(root, 'cache')
    )
    expect(parsed[0]?.session).toMatchObject({
      title: 'Original name',
      projectPath: '/project/cursor',
      messageCount: 0,
      warnings: ['CURSOR_LEGACY_HEADERS_ONLY']
    })
    expect(parsed[0]?.messages).toEqual([])
  })
})

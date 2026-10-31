// @vitest-environment node
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { builtinModules } from 'node:module'
import { fork, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { beforeAll, afterAll, afterEach, expect, it } from 'vitest'
import { build } from 'vite'
import { JsonStore } from './storage'
import { restoreTransaction } from '../backup/restore-transaction'
import { withFileLease } from './file-lease'

let root: string
let fixture: string
const children: ChildProcess[] = []
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-store-process-'))
  await build({
    configFile: false,
    logLevel: 'silent',
    resolve: { alias: { '@shared': path.resolve('src/shared') } },
    build: {
      outDir: path.join(root, 'lib'),
      lib: {
        entry: {
          storage: path.resolve('src/main/services/storage.ts'),
          lease: path.resolve('src/main/services/file-lease.ts'),
          restore: path.resolve('src/main/backup/restore-transaction.ts')
        },
        formats: ['es'],
        fileName: (_, name) => `${name}.mjs`
      },
      rolldownOptions: {
        external: [...builtinModules, ...builtinModules.map((name) => `node:${name}`)]
      }
    }
  })
  fixture = path.join(root, 'writer.mjs')
  await fs.writeFile(
    fixture,
    `
import { JsonStore } from './lib/storage.mjs';
import { withFileLease } from './lib/lease.mjs';
const target = process.argv[2];
if (process.argv[3] === 'hold') {
  await withFileLease(target, async () => { process.send('ready'); await new Promise(resolve => { process.on('message', message => { if (message === 'release') resolve(); }); }); });
  process.disconnect();
} else {
  const store = new JsonStore(target, { a: 0, b: 0 });
  await store.read(); process.send('ready');
  process.once('message', async patch => {
    try { await store.update(patch); process.send({ success: true }); }
    catch(error) { process.send({ success: false, code: error.code }); }
    process.disconnect();
  });
}
`
  )
}, 30000)
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit')
      child.kill('SIGKILL')
      await exited
    }
  }
})
afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true })
})
async function writer(target: string, hold = false) {
  const child = fork(fixture, [target, hold ? 'hold' : 'write'], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    execArgv: []
  })
  children.push(child)
  const [ready] = await once(child, 'message')
  expect(ready).toBe('ready')
  return child
}
it.each([false, true])(
  'rejects a competing process instead of silently overwriting: same field=%s',
  async (same) => {
    const target = path.join(root, `concurrent-${same}.json`)
    await fs.writeFile(target, '{"a":0,"b":0}')
    const [left, right] = await Promise.all([writer(target), writer(target)])
    const results = [once(left, 'message'), once(right, 'message')]
    left.send({ a: 1 })
    right.send(same ? { a: 2 } : { b: 2 })
    const responses = (await Promise.all(results)).map(
      ([message]) => message as { success: boolean; code?: string }
    )
    expect(responses.filter((message) => message.success)).toHaveLength(1)
    expect(responses.find((message) => !message.success)?.code).toBe('CONFIG_CONFLICT')
    expect(JSON.parse(await fs.readFile(target, 'utf8'))).toMatchObject({
      a: expect.any(Number),
      b: expect.any(Number)
    })
  },
  10000
)
it('reclaims a provably dead process lease and preserves the committed file', async () => {
  const target = path.join(root, 'crash.json')
  await fs.writeFile(target, '{"a":1}')
  const child = await writer(target, true)
  const store = new JsonStore(target, { a: 0 })
  await expect(store.update({ a: 2 })).rejects.toMatchObject({ code: 'CONFIG_CONFLICT' })
  const exited = once(child, 'exit')
  child.kill('SIGKILL')
  await exited
  await store.update({ a: 3 })
  expect(JSON.parse(await fs.readFile(target, 'utf8'))).toEqual({ a: 3 })
}, 10000)
it('lets a consistent reader wait for an active writer without reading its partial state', async () => {
  const target = path.join(root, 'reader-wait.json')
  await fs.writeFile(target, '{"a":1}')
  const child = await writer(target, true)
  let entered = false
  const reading = withFileLease(
    target,
    async () => {
      entered = true
      return fs.readFile(target, 'utf8')
    },
    undefined,
    { waitMs: 1500 }
  )
  await new Promise((resolve) => setTimeout(resolve, 60))
  expect(entered).toBe(false)
  const exited = once(child, 'exit')
  child.send('release')
  await exited
  await expect(reading).resolves.toBe('{"a":1}')
  expect(entered).toBe(true)
}, 10000)
it('detects stale cache after an external edit and allows explicit reload', async () => {
  const target = path.join(root, 'external.json')
  const store = new JsonStore(target, { a: 0 })
  await store.write({ a: 1 })
  await fs.writeFile(target, '{"a":9}')
  await expect(store.update({ a: 2 })).rejects.toMatchObject({ code: 'CONFIG_CONFLICT' })
  expect(await fs.readFile(target, 'utf8')).toBe('{"a":9}')
  store.invalidate()
  await store.update({ a: 3 })
  expect(store.peek()).toEqual({ a: 3 })
})

it.each(['before-first', 'after-first', 'after-all'])(
  'detects and safely continues a multi-file commit after the writer exits: %s',
  async (stage) => {
    const directory = path.join(root, `restore-crash-${stage}`)
    await fs.mkdir(directory)
    await fs.writeFile(path.join(directory, 'models.json'), '{"providers":{}}')
    await fs.writeFile(path.join(directory, 'settings.json'), '{"revision":1}')
    const script = path.join(root, `crash-restore-${stage}.mjs`)
    await fs.writeFile(
      script,
      `
import fs from 'node:fs/promises';
import path from 'node:path';
import { restoreTransaction } from './lib/restore.mjs';
import { withFileLease } from './lib/lease.mjs';
const directory = process.argv[2];
const rename = fs.rename.bind(fs);
fs.rename = async (from, to) => {
  const stage = process.argv[3];
  if (stage === 'before-first' && to === path.join(directory, 'models.json')) process.exit(7);
  if (stage === 'after-first' && to === path.join(directory, 'settings.json')) process.exit(7);
  if (stage === 'after-all' && to === path.join(directory, 'journal.json') && JSON.parse(await fs.readFile(from, 'utf8')).status === 'completed') process.exit(7);
  return rename(from, to);
};
await withFileLease(path.join(directory, 'config-writer'), () => restoreTransaction(directory, path.join(directory, 'journal.json'), 'crash', async () => new Map([['models.json','{"providers":{},"revision":2}'],['settings.json','{"revision":2}']])), 'fixture-recovery');
`
    )
    const child = fork(script, [directory, stage], { stdio: 'pipe', execArgv: [] })
    children.push(child)
    const [code] = await once(child, 'exit')
    expect(code).toBe(7)
    expect(await fs.readFile(path.join(directory, 'settings.json'), 'utf8')).toBe(
      stage === 'after-all' ? '{"revision":2}' : '{"revision":1}'
    )
    const journal = path.join(directory, 'journal.json')
    expect(JSON.parse(await fs.readFile(journal, 'utf8')).status).toBe('committing')
    await expect(
      withFileLease(path.join(directory, 'config-writer'), async () => undefined)
    ).rejects.toMatchObject({ code: 'CONFIG_CONFLICT' })
    await withFileLease(
      path.join(directory, 'config-writer'),
      () =>
        restoreTransaction(directory, journal, 'crash', async () => {
          throw new Error('source is unavailable')
        }),
      'fixture-recovery'
    )
    expect(await fs.readFile(path.join(directory, 'settings.json'), 'utf8')).toBe('{"revision":2}')
    expect(await fs.readFile(path.join(directory, 'models.json'), 'utf8')).toBe(
      '{"providers":{},"revision":2}'
    )
  },
  10000
)

it.each(['before-publish', 'after-publish'])(
  'survives termination %s of complete lease ownership',
  async (stage) => {
    const target = path.join(root, `publish-${stage}.json`)
    const script = path.join(root, `publish-${stage}.mjs`)
    await fs.writeFile(
      script,
      `
import fs from 'node:fs/promises';
import { withFileLease } from './lib/lease.mjs';
const original = fs.link.bind(fs);
fs.link = async (...args) => {
  if (process.argv[3] === 'before-publish') process.exit(7);
  await original(...args); process.exit(7);
};
await withFileLease(process.argv[2], async () => {});
`
    )
    const child = fork(script, [target, stage], { stdio: 'pipe', execArgv: [] })
    children.push(child)
    expect((await once(child, 'exit'))[0]).toBe(7)
    const lock = path.join(root, `.${path.basename(target)}.harness-lock`)
    if (stage === 'before-publish')
      await expect(fs.stat(lock)).rejects.toMatchObject({ code: 'ENOENT' })
    else expect(JSON.parse(await fs.readFile(lock, 'utf8')).pid).toBe(child.pid)
    const store = new JsonStore(target, { a: 0 })
    await store.update({ a: 1 })
    expect(JSON.parse(await fs.readFile(target, 'utf8'))).toEqual({ a: 1 })
  }
)

it.each(['', '{partial', JSON.stringify({ pid: process.pid }), JSON.stringify({ pid: -1 })])(
  'preserves unverifiable or reused live-PID ownership: %s',
  async (metadata) => {
    const target = path.join(root, `unknown-${Math.random()}.json`)
    const lock = path.join(root, `.${path.basename(target)}.harness-lock`)
    await fs.writeFile(lock, metadata)
    await expect(withFileLease(target, async () => undefined)).rejects.toMatchObject({
      code: 'CONFIG_CONFLICT'
    })
    expect(await fs.readFile(lock, 'utf8')).toBe(metadata)
  }
)

it('preserves an orphaned reclaim guard instead of deleting an unknown owner', async () => {
  const target = path.join(root, 'orphan-guard.json')
  const child = await writer(target, true)
  const exited = once(child, 'exit')
  child.kill('SIGKILL')
  await exited
  const lock = path.join(root, '.orphan-guard.json.harness-lock')
  const original = await fs.readFile(lock, 'utf8')
  await fs.mkdir(`${lock}.reclaim`)
  await expect(withFileLease(target, async () => undefined)).rejects.toMatchObject({
    code: 'CONFIG_CONFLICT'
  })
  expect(await fs.readFile(lock, 'utf8')).toBe(original)
  expect((await fs.stat(`${lock}.reclaim`)).isDirectory()).toBe(true)
})

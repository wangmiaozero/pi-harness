// @vitest-environment node
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterEach, expect, it, vi } from 'vitest'
import { copyDmgApplication } from '../../../scripts/release/mac-dmg.mjs'

const exec = promisify(execFile)
const temporary: string[] = []
afterEach(async () => {
  for (const dir of temporary.splice(0)) await fs.rm(dir, { recursive: true, force: true })
})
async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-dmg-lifecycle-'))
  temporary.push(dir)
  const mount = path.join(dir, 'mount')
  await fs.mkdir(mount)
  return {
    dir,
    mount,
    installed: path.join(dir, 'Applications/Pi-Harness.app'),
    diagnostics: path.join(dir, 'mount.json')
  }
}
function transport(failures: number, copyFailure = false, busy = true) {
  let mounted = false
  const run = vi.fn(async (file: string, args: string[]) => {
    if (args[0] === 'attach') mounted = true
    if (file.endsWith('ditto') && copyFailure) throw new Error('Copy failed')
    if (args[0] === 'detach') {
      if (failures-- > 0)
        throw Object.assign(new Error('Detach failed'), {
          code: busy ? 16 : 1,
          stderr: busy ? 'Resource busy' : 'Other failure'
        })
      mounted = false
    }
    return { stdout: '', stderr: '' }
  })
  return { run, wait: vi.fn(async (_milliseconds: number) => {}), isMounted: async () => mounted }
}
it('waits for copying, retries only busy detach with bounded backoff, and keeps holder diagnostics', async () => {
  const f = await fixture(),
    io = transport(2)
  await copyDmgApplication('image.dmg', f.mount, f.installed, f.diagnostics, io)
  expect(io.run.mock.calls.filter(([, args]) => args[0] === 'detach')).toHaveLength(3)
  expect(io.wait.mock.calls.map((args) => args[0])).toEqual([250, 500])
  expect(io.run.mock.calls.some(([, args]) => args.includes('-force'))).toBe(false)
  const record = JSON.parse(await fs.readFile(f.diagnostics, 'utf8'))
  expect(record.detached).toBe(true)
  expect(record.attempts).toHaveLength(2)
  expect(io.run.mock.calls.findIndex(([file]) => file.endsWith('ditto'))).toBeLessThan(
    io.run.mock.calls.findIndex(([, args]) => args[0] === 'detach')
  )
})
it('detaches in finally when copying fails and preserves the original failure', async () => {
  const f = await fixture(),
    io = transport(0, true)
  await expect(
    copyDmgApplication('image.dmg', f.mount, f.installed, f.diagnostics, io)
  ).rejects.toThrow('Copy failed')
  expect(await io.isMounted()).toBe(false)
})
it.each([true, false])(
  'fails honestly and preserves an attached image when cleanup cannot finish (busy=%s)',
  async (busy) => {
    const f = await fixture(),
      io = transport(10, false, busy)
    await expect(
      copyDmgApplication('image.dmg', f.mount, f.installed, f.diagnostics, io)
    ).rejects.toMatchObject({ mountStillAttached: true })
    expect(io.run.mock.calls.filter(([, args]) => args[0] === 'detach')).toHaveLength(busy ? 4 : 1)
    expect(JSON.parse(await fs.readFile(f.diagnostics, 'utf8')).detached).toBe(false)
  }
)
it('cleans a partial attach even when hdiutil reports failure', async () => {
  const f = await fixture(),
    io = transport(0)
  const original = io.run.getMockImplementation()!
  io.run.mockImplementation(async (file, args) => {
    const result = await original(file, args)
    if (args[0] === 'attach') throw new Error('Partial attach')
    return result
  })
  await expect(
    copyDmgApplication('image.dmg', f.mount, f.installed, f.diagnostics, io)
  ).rejects.toThrow('Partial attach')
  expect(await io.isMounted()).toBe(false)
})
it.runIf(process.platform === 'darwin')(
  'copies a real readonly DMG and releases the native mount',
  async () => {
    const f = await fixture(),
      source = path.join(f.dir, 'source/Pi-Harness.app')
    await fs.mkdir(source, { recursive: true })
    await fs.writeFile(path.join(source, 'marker.txt'), 'real DMG fixture')
    const image = path.join(f.dir, 'fixture.dmg')
    await exec(
      '/usr/bin/hdiutil',
      [
        'create',
        '-size',
        '16m',
        '-fs',
        'HFS+',
        '-volname',
        'PiHarness-test',
        '-srcfolder',
        path.dirname(source),
        '-format',
        'UDRO',
        image
      ],
      { timeout: 60000 }
    )
    await copyDmgApplication(image, f.mount, f.installed, f.diagnostics)
    expect(await fs.readFile(path.join(f.installed, 'marker.txt'), 'utf8')).toBe('real DMG fixture')
    expect((await fs.stat(f.mount)).dev).toBe((await fs.stat(f.dir)).dev)
  },
  90000
)

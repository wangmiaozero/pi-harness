// @vitest-environment node
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'
import { afterEach, expect, it, vi } from 'vitest'
import { copyDmgApplication } from '../../../scripts/release/mac-dmg.mjs'

const exec = promisify(execFile)
const require = createRequire(import.meta.url)
const builder = createRequire(require.resolve('electron-builder'))
const dependencies = createRequire(builder.resolve('app-builder-lib'))
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
    // Build the fixture directly from files. create -srcfolder first populates
    // a temporary volume, adding a mount lifecycle before the one under test.
    await exec(
      '/usr/bin/hdiutil',
      [
        'makehybrid',
        '-hfs',
        '-hfs-volume-name',
        'PiHarness-test',
        '-o',
        image,
        path.dirname(source)
      ],
      { timeout: 60000 }
    )
    await copyDmgApplication(image, f.mount, f.installed, f.diagnostics)
    expect(await fs.readFile(path.join(f.installed, 'marker.txt'), 'utf8')).toBe('real DMG fixture')
    expect((await fs.stat(f.mount)).dev).toBe((await fs.stat(f.dir)).dev)
  },
  90000
)

it.runIf(process.platform === 'darwin')(
  'builds a real installer with Spotlight exclusion copied before the application',
  async () => {
    const f = await fixture()
    const source = path.join(f.dir, 'source/Pi-Harness.app')
    await fs.mkdir(source, { recursive: true })
    await fs.writeFile(path.join(source, 'marker.txt'), 'signed-resource fixture')
    const { load } = dependencies('js-yaml')
    const { dmg } = load(await fs.readFile('electron-builder.yml', 'utf8'))
    const { customizeDmg } = dependencies('dmg-builder')
    const settings = path.join(f.dir, 'settings.json')
    const image = path.join(f.dir, 'installer.dmg')
    await customizeDmg({
      appPath: source,
      artifactPath: image,
      volumeName: `PiHarness-${path.basename(f.dir)}`,
      specification: { ...dmg, format: 'UDRO' },
      packager: {
        info: { getWorkspaceRoot: async () => process.cwd() },
        getResource: async () => null,
        getTempFile: async () => settings,
        packagerOptions: {}
      }
    })
    // Check the effective input to the pinned tool, not only our YAML text.
    const effective = JSON.parse(await fs.readFile(settings, 'utf8'))
    expect(effective.contents[0].path).toBe('build/dmg/.metadata_never_index')
    expect(effective.contents[1].path).toBe(source)
    await exec('/usr/bin/hdiutil', ['verify', image], { timeout: 30000 })
    let inspected = false
    await copyDmgApplication(image, f.mount, f.installed, f.diagnostics, {
      run: async (file: string, args: string[], options: object) => {
        if (file === '/usr/bin/ditto') {
          expect(await fs.readFile(path.join(f.mount, '.metadata_never_index'), 'utf8')).toBe('')
          expect(await fs.readlink(path.join(f.mount, 'Applications'))).toBe('/Applications')
          inspected = true
        }
        return exec(file, args, options)
      }
    })
    expect(inspected).toBe(true)
    expect(await fs.readFile(path.join(f.installed, 'marker.txt'), 'utf8')).toBe(
      'signed-resource fixture'
    )
    await expect(fs.stat(path.join(f.installed, '.metadata_never_index'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
    expect((await fs.stat(f.mount)).dev).toBe((await fs.stat(f.dir)).dev)
  },
  90000
)

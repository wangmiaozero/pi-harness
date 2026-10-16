// @vitest-environment node
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { NodeInstaller } from './node-installer'
const mocks = vi.hoisted(() => ({ persist: vi.fn(), refresh: vi.fn() }))
vi.mock('./path-manager', () => ({
  persistUserPath: mocks.persist,
  refreshRuntimePath: mocks.refresh
}))
vi.mock('./command-resolver', () => ({
  readExecutableVersion: vi.fn(async (file: string) =>
    file.endsWith('node.exe') ? '24.22.0' : '11.19.1'
  )
}))
const directories: string[] = []
afterEach(async () => {
  vi.clearAllMocks()
  for (const dir of directories.splice(0)) await fs.rm(dir, { recursive: true, force: true })
})
for (const fixture of ['safe', 'symlink', 'leaf-write']) {
  it(`uses the shared verified ZIP extractor for a Windows installer ${fixture} fixture without changing files outside staging`, async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'node-archive-'))
    directories.push(directory)
    const root = path.join(directory, 'node')
    await fs.mkdir(root)
    await fs.writeFile(path.join(root, 'retained.txt'), 'original')
    const archive = await fs.readFile(path.resolve(`fixtures/runtime/node-win32-${fixture}.zip`))
    const sha256 = createHash('sha256').update(archive).digest('hex')
    const installer = new NodeInstaller({
      platform: 'win32',
      arch: 'x64',
      root: () => root,
      downloads: () => path.join(directory, 'downloads'),
      fetch: async (url) => {
        if (String(url).endsWith('index.json'))
          return new Response(
            JSON.stringify([{ version: 'v24.22.0', lts: 'Krypton', files: ['win-x64-zip'] }])
          )
        if (String(url).endsWith('SHASUMS256.txt'))
          return new Response(`${sha256}  node-v24.22.0-win-x64.zip\n`)
        return new Response(archive)
      }
    })
    vi.spyOn(installer, 'detect').mockResolvedValue({
      nodeSupported: false,
      npmInstalled: false
    } as any)
    if (fixture === 'safe') {
      await expect(installer.install()).resolves.toMatchObject({
        skipped: false,
        version: '24.22.0'
      })
      expect(await fs.readFile(path.join(root, 'node.exe'), 'utf8')).toBe('fixture node')
      expect(mocks.persist).toHaveBeenCalledOnce()
    } else {
      await expect(installer.install()).rejects.toThrow('failed')
      expect(await fs.readFile(path.join(root, 'retained.txt'), 'utf8')).toBe('original')
      expect(mocks.persist).not.toHaveBeenCalled()
    }
    await expect(fs.stat(path.join(directory, 'outside'))).rejects.toThrow()
    expect((await fs.readdir(directory)).some((name) => name.startsWith('.node-install-'))).toBe(
      false
    )
  })
}

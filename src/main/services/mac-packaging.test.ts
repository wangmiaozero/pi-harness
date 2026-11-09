// @vitest-environment node
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Arch, Platform } from 'electron-builder'
import { buildMac, buildMacWithCleanup } from '../../../scripts/electron-builder-mac.mjs'
import { cleanUnpackedMac } from '../../../scripts/clean-unpacked-mac.mjs'

const builder = vi.hoisted(() => ({ build: vi.fn() }))
vi.mock('electron-builder', async (importOriginal) => ({
  ...(await importOriginal<typeof import('electron-builder')>()),
  build: builder.build
}))

const temporary: string[] = []
const unpacked = ['mac', 'mac-arm64', 'mac-universal', 'mac-x64']

afterEach(async () => {
  vi.restoreAllMocks()
  builder.build.mockReset()
  for (const directory of temporary.splice(0))
    await fs.rm(directory, { recursive: true, force: true })
})

async function fixture() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mac-packaging-'))
  temporary.push(projectDir)
  const directory = path.join(projectDir, 'release')
  for (const name of unpacked)
    await fs.mkdir(path.join(directory, name, 'Pi-Harness.app'), { recursive: true })
  const preserved = [
    path.join(projectDir, 'Applications/Pi-Harness.app/Contents/Info.plist'),
    path.join(directory, 'Pi-Harness.dmg'),
    path.join(directory, 'Pi-Harness-mac.zip'),
    path.join(directory, 'Pi-Harness.dmg.blockmap'),
    path.join(directory, 'latest-mac.yml'),
    path.join(directory, 'linux-unpacked/pi-harness')
  ]
  for (const file of preserved) {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, 'preserve')
  }
  return { projectDir, directory, preserved }
}

it('removes all staging apps only after macOS artifacts finish', async () => {
    const { projectDir, directory, preserved } = await fixture()
    const artifacts = preserved.filter((file) => /\.(dmg|zip)$/.test(file))
    builder.build.mockImplementation(async (options) => {
      expect(options.targets.get(Platform.MAC)).toEqual(
        new Map([
          [Arch.arm64, []],
          [Arch.x64, []]
        ])
      )
      expect(options.config).toBe('electron-builder.yml')
      for (const name of unpacked)
        await expect(fs.stat(path.join(directory, name, 'Pi-Harness.app'))).resolves.toBeTruthy()
      // Packaging still needs the staging app while it writes the final ZIP.
      await fs.writeFile(artifacts[1], 'completed')
      return artifacts
    })
    await expect(buildMac({ projectDir, arches: ['arm64', 'x64'] })).resolves.toEqual(
      artifacts
    )
    for (const name of unpacked)
      await expect(fs.stat(path.join(directory, name))).rejects.toMatchObject({ code: 'ENOENT' })
    for (const file of preserved)
      expect(await fs.readFile(file, 'utf8')).toBe(file === artifacts[1] ? 'completed' : 'preserve')
  }
)

it('cleans failed macOS builds and preserves the failure', async () => {
    const { projectDir, directory, preserved } = await fixture()
    const error = new Error('DMG creation failed')
    builder.build.mockRejectedValue(error)
    await expect(buildMac({ projectDir, arches: ['arm64'] })).rejects.toBe(error)
    for (const name of unpacked)
      await expect(fs.stat(path.join(directory, name))).rejects.toMatchObject({ code: 'ENOENT' })
    for (const file of preserved) expect(await fs.readFile(file, 'utf8')).toBe('preserve')
  }
)

it('fails packaging when staging app cleanup fails', async () => {
  const { projectDir } = await fixture()
  builder.build.mockResolvedValue([])
  const error = Object.assign(new Error('Cleanup denied'), { code: 'EACCES' })
  vi.spyOn(fs, 'rm').mockRejectedValueOnce(error)
  await expect(buildMac({ projectDir, arches: ['arm64'] })).rejects.toBe(error)
})

it('cleans upgrade staging on a failed DMG build without accepting partial artifacts', async () => {
    const { projectDir } = await fixture()
    const directory = path.join(projectDir, 'out/update-validation/darwin-x64', 'standard', '2.3.19')
    const app = path.join(directory, 'mac/Pi-Harness.app')
    await fs.mkdir(app, { recursive: true })
    const zip = path.join(directory, 'Pi-Harness.zip')
    const options = { config: { directories: { output: directory } } }
    const error = new Error('Unable to detach device cleanly: Resource busy')
    builder.build.mockImplementation(async (actual) => {
      expect(actual).toBe(options)
      await expect(fs.stat(app)).resolves.toBeTruthy()
      await fs.writeFile(zip, 'completed ZIP, failed DMG')
      throw error
    })
    await expect(buildMacWithCleanup(options, directory)).rejects.toBe(error)
    await expect(fs.stat(app)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await fs.readFile(zip, 'utf8')).toBe('completed ZIP, failed DMG')
  }
)

it('unlinks staging symlinks without deleting their targets and tolerates missing directories', async () => {
  const { projectDir, directory, preserved } = await fixture()
  const staging = path.join(directory, 'mac-arm64')
  await fs.rm(staging, { recursive: true })
  await fs.symlink(path.join(projectDir, 'Applications'), staging, 'junction')
  await cleanUnpackedMac(directory)
  await cleanUnpackedMac(directory)
  await cleanUnpackedMac(path.join(projectDir, 'missing'))
  for (const file of preserved) expect(await fs.readFile(file, 'utf8')).toBe('preserve')
})

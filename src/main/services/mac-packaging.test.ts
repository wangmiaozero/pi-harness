// @vitest-environment node
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { Arch, Platform } from 'electron-builder'
import { buildMac } from '../../../scripts/electron-builder-mac.mjs'
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

async function fixture(nomascot: boolean) {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mac-packaging-'))
  temporary.push(projectDir)
  const directory = path.join(projectDir, 'release', ...(nomascot ? ['nomascot'] : []))
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

it.each([false, true])(
  'removes all staging apps only after macOS artifacts finish (nomascot=%s)',
  async (nomascot) => {
    const { projectDir, directory, preserved } = await fixture(nomascot)
    const artifacts = preserved.filter((file) => /\.(dmg|zip)$/.test(file))
    builder.build.mockImplementation(async (options) => {
      expect(options.targets.get(Platform.MAC)).toEqual(
        new Map([
          [Arch.arm64, []],
          [Arch.x64, []]
        ])
      )
      expect(options.config).toBe(
        nomascot ? 'electron-builder.nomascot.yml' : 'electron-builder.yml'
      )
      for (const name of unpacked)
        await expect(fs.stat(path.join(directory, name, 'Pi-Harness.app'))).resolves.toBeTruthy()
      // Packaging still needs the staging app while it writes the final ZIP.
      await fs.writeFile(artifacts[1], 'completed')
      return artifacts
    })
    await expect(buildMac({ projectDir, arches: ['arm64', 'x64'], nomascot })).resolves.toEqual(
      artifacts
    )
    for (const name of unpacked)
      await expect(fs.stat(path.join(directory, name))).rejects.toMatchObject({ code: 'ENOENT' })
    for (const file of preserved)
      expect(await fs.readFile(file, 'utf8')).toBe(file === artifacts[1] ? 'completed' : 'preserve')
  }
)

it.each([false, true])(
  'cleans failed macOS builds and preserves the failure (nomascot=%s)',
  async (nomascot) => {
    const { projectDir, directory, preserved } = await fixture(nomascot)
    const error = new Error('DMG creation failed')
    builder.build.mockRejectedValue(error)
    await expect(buildMac({ projectDir, arches: ['arm64'], nomascot })).rejects.toBe(error)
    for (const name of unpacked)
      await expect(fs.stat(path.join(directory, name))).rejects.toMatchObject({ code: 'ENOENT' })
    for (const file of preserved) expect(await fs.readFile(file, 'utf8')).toBe('preserve')
  }
)

it('fails packaging when staging app cleanup fails', async () => {
  const { projectDir } = await fixture(false)
  builder.build.mockResolvedValue([])
  const error = Object.assign(new Error('Cleanup denied'), { code: 'EACCES' })
  vi.spyOn(fs, 'rm').mockRejectedValueOnce(error)
  await expect(buildMac({ projectDir, arches: ['arm64'] })).rejects.toBe(error)
})

it('unlinks staging symlinks without deleting their targets and tolerates missing directories', async () => {
  const { projectDir, directory, preserved } = await fixture(false)
  const staging = path.join(directory, 'mac-arm64')
  await fs.rm(staging, { recursive: true })
  await fs.symlink(path.join(projectDir, 'Applications'), staging, 'junction')
  await cleanUnpackedMac(directory)
  await cleanUnpackedMac(directory)
  await cleanUnpackedMac(path.join(projectDir, 'missing'))
  for (const file of preserved) expect(await fs.readFile(file, 'utf8')).toBe('preserve')
})

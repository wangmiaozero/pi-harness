// @vitest-environment node
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { applyMountedBundle, parseDiskImageMount, stageMacUpdate } from './mac-apply'
import { installVerifiedUpdate } from './update-installer'
import { signingFixture } from './security/signing-fixture'

const temporary: string[] = []
afterEach(async () => {
  for (const dir of temporary.splice(0)) await fs.rm(dir, { recursive: true, force: true })
})

it('accepts only a single volume mount point', () => {
  expect(parseDiskImageMount('<key>mount-point</key><string>/Volumes/Pi-Harness</string>')).toBe(
    '/Volumes/Pi-Harness'
  )
  expect(() =>
    parseDiskImageMount('<key>mount-point</key><string>/tmp/Pi-Harness</string>')
  ).toThrow()
  expect(() =>
    parseDiskImageMount('<key>mount-point</key><string>/Volumes/../etc</string>')
  ).toThrow()
  expect(() =>
    parseDiskImageMount('<key>mount-point</key><string>/Volumes/Pi/Nested</string>')
  ).toThrow()
})

it('stages the verified app and swaps it only after this process exits', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mac-apply-'))
  temporary.push(root)
  const volume = path.join(root, 'volume')
  const bundle = path.join(root, 'Pi-Harness.app')
  const stage = path.join(root, 'stage')
  await fs.mkdir(path.join(volume, 'Pi-Harness.app'), { recursive: true })
  await fs.mkdir(bundle, { recursive: true })
  await fs.mkdir(stage, { recursive: true })
  const calls: string[][] = []
  const spawned: string[][] = []
  await applyMountedBundle({
    mount: volume,
    bundle,
    stageRoot: stage,
    pid: 4242,
    run: async (command, args) => {
      calls.push([command, ...args])
      if (command === 'ditto') await fs.cp(args[0], args[1], { recursive: true })
      return ''
    },
    spawnHelper: (_script, args) => spawned.push(args)
  })
  expect(calls.map((call) => call[0])).toEqual(['ditto'])
  expect(spawned).toEqual([['4242', path.join(stage, 'Pi-Harness.app'), bundle]])
  const script = await fs.readFile(path.join(stage, 'apply-update.sh'), 'utf8')
  expect(script).toContain('"$target"')
  expect(script).not.toContain(bundle)
})

it('does not mount an image when the running bundle cannot be replaced', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mac-apply-'))
  temporary.push(root)
  const image = path.join(root, 'Pi-Harness.dmg')
  await fs.writeFile(image, 'disk')
  const calls: string[] = []
  await expect(
    stageMacUpdate({
      file: image,
      bundle: path.join(root, 'Other.app'),
      stageRoot: root,
      pid: 1,
      run: async (command) => {
        calls.push(command)
        return ''
      }
    })
  ).rejects.toMatchObject({ reason: 'INSTALL_UNSUPPORTED' })
  expect(calls).toEqual([])
})

it('restarts a verified macOS download without the native installer evidence gate', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mac-apply-'))
  temporary.push(root)
  const fixture = signingFixture('2.2.2')
  const installer = fixture.manifest.artifacts.find(
    (item) => item.platform === 'darwin' && item.arch === 'arm64' && item.file.endsWith('.dmg')
  )!
  const bundle = path.join(root, 'Pi-Harness.app')
  const image = path.join(root, installer.file)
  await fs.mkdir(bundle, { recursive: true })
  await fs.writeFile(image, fixture.payload)
  let restarted = false
  let staged = false
  const quit = () => {
    restarted = true
  }
  const relaunch = () => {
    throw new Error('relaunch')
  }
  await installVerifiedUpdate({
    platform: 'darwin',
    arch: 'arm64',
    variant: 'standard',
    currentVersion: '2.2.1',
    candidate: {
      version: '2.2.2',
      manifest: fixture.manifest,
      installer,
      bytes: fixture.bytes,
      signature: fixture.signature
    },
    file: image,
    journal: path.join(root, 'upgrade.json'),
    interactive: true,
    bundle,
    relaunch,
    quit,
    stageMac: async () => {
      staged = true
    }
  })
  expect(staged).toBe(true)
  expect(restarted).toBe(true)
  await expect(
    installVerifiedUpdate({
      platform: 'darwin',
      arch: 'arm64',
      variant: 'standard',
      currentVersion: '2.2.1',
      candidate: {
        version: '2.2.2',
        manifest: fixture.manifest,
        installer,
        bytes: fixture.bytes,
        signature: fixture.signature
      },
      file: image,
      journal: path.join(root, 'upgrade.json'),
      relaunch,
      quit
    })
  ).rejects.toMatchObject({ reason: 'INSTALL_UNVERIFIED' })
})

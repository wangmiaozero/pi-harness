import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import { afterEach, expect, it } from 'vitest'
// @ts-expect-error Packaging helpers execute as Node ESM without declarations.
import { verifyPetArchive } from '../../../scripts/runtime/pet-archive.mjs'

const require = createRequire(import.meta.url)
const builder = createRequire(require.resolve('electron-builder'))
const dependencies = createRequire(builder.resolve('app-builder-lib'))
const asar = dependencies('@electron/asar')
const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) =>
        fs.rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
      )
  )
})

it('preserves nested frame bytes and licenses and rejects missing or changed archive data', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-archive-'))
  directories.push(directory)
  const source = path.join(directory, 'app/resources/petpacks')
  const frames = path.join(source, 'bigfish/clips/indesktop-lion-dance')
  await fs.mkdir(frames, { recursive: true })
  const frame = path.join(frames, 'indesktop-lion-dance_001.webp')
  await fs.writeFile(frame, Buffer.from('RIFF\x00\x01\x02\x03WEBPframe'))
  await fs.writeFile(path.join(source, 'bigfish/LICENSE'), 'Fixture license')
  const archive = path.join(directory, 'app.asar')
  await asar.createPackage(path.join(directory, 'app'), archive)
  expect(await verifyPetArchive(archive, source)).toBe(2)
  await fs.writeFile(frame, Buffer.from('RIFFdifferentWEBP'))
  await expect(verifyPetArchive(archive, source)).rejects.toThrow('differs from source')
  await fs.writeFile(path.join(frames, 'missing.webp'), 'missing')
  await fs.rm(frame)
  await expect(verifyPetArchive(archive, source)).rejects.toThrow()
})

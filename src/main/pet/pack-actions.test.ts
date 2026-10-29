import { describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import { loadPetPack, validatePetPackManifest } from './pack'
const root = path.resolve('resources/petpacks/bigfish')
describe('manual animation pack', () => {
  it('loads the original actions and all 92 newly imported motions with complete resources', async () => {
    const pack = await loadPetPack(root)
    const actions = Object.entries(pack.manifest.clips).filter(([, clip]) => clip.labels)
    expect(actions).toHaveLength(193)
    expect(actions.filter(([key]) => key.startsWith('classic-'))).toHaveLength(29)
    expect(actions.filter(([key]) => key.startsWith('playful-'))).toHaveLength(72)
    expect(actions.filter(([key]) => key.startsWith('indesktop-'))).toHaveLength(92)
    expect(pack.manifest.clips['indesktop-lion-dance'].labels?.['zh-CN']).toBe('舞狮头')
    for (const [, clip] of actions) {
      expect(clip.frameDurationsMs).toHaveLength(clip.frames)
      expect(clip.labels?.['zh-CN']).toBeTruthy()
      expect(clip.labels?.['en-US']).toBeTruthy()
    }
  })
  it('covers every source animation without duplicating existing source clips', async () => {
    const pack = await loadPetPack(root)
    const sources = JSON.parse(
      await fs.readFile(path.join(root, 'indesktop-motions.json'), 'utf8')
    ) as { animations: Array<{ file: string; sha256: string; clip: string; reused: boolean }> }
    expect(sources.animations).toHaveLength(106)
    expect(new Set(sources.animations.map((entry) => entry.file)).size).toBe(106)
    expect(sources.animations.filter((entry) => entry.reused)).toHaveLength(14)
    for (const entry of sources.animations) {
      expect(entry.sha256).toMatch(/^[a-f0-9]{64}$/)
      expect(pack.manifest.clips[entry.clip]).toBeDefined()
      if (!entry.reused)
        expect(pack.manifest.clips[entry.clip].labels?.['zh-CN']).toBe(
          path.basename(entry.file, '.webm')
        )
    }
    for (const license of pack.manifest.licenseFiles)
      expect((await fs.readFile(path.join(root, license), 'utf8')).trim()).not.toBe('')
  })
  it('bounds the expanded catalog instead of allowing unlimited clips', async () => {
    const manifest = JSON.parse(await fs.readFile(path.join(root, 'pet-pack.json'), 'utf8'))
    manifest.clips = Object.fromEntries(
      Array.from({ length: 256 }, (_, index) => [`action-${index}`, { frames: 1, loop: false }])
    )
    expect(Object.keys(validatePetPackManifest(manifest).clips)).toHaveLength(256)
    manifest.clips['one-too-many'] = { frames: 1, loop: false }
    expect(() => validatePetPackManifest(manifest)).toThrow('clip count')
  })
  it.each([[0], [Infinity], [NaN], [-10], [10001], ['100']])(
    'rejects invalid frame timing %s',
    async (value) => {
      const manifest = JSON.parse(await fs.readFile(path.join(root, 'pet-pack.json'), 'utf8'))
      manifest.clips.idle.frameDurationsMs = Array(manifest.clips.idle.frames).fill(value)
      expect(() => validatePetPackManifest(manifest)).toThrow('durations')
    }
  )
})

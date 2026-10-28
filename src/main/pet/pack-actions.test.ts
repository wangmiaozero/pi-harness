import { describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import { loadPetPack, validatePetPackManifest } from './pack'
const root = path.resolve('resources/petpacks/bigfish')
describe('manual animation pack', () => {
  it('loads all 101 additional playable clips with timing and complete resources', async () => {
    const pack = await loadPetPack(root)
    const actions = Object.entries(pack.manifest.clips).filter(([, clip]) => clip.labels)
    expect(actions).toHaveLength(101)
    expect(actions.filter(([key]) => key.startsWith('classic-'))).toHaveLength(29)
    expect(actions.filter(([key]) => key.startsWith('playful-'))).toHaveLength(72)
    for (const [, clip] of actions) {
      expect(clip.frameDurationsMs).toHaveLength(clip.frames)
      expect(clip.labels?.['zh-CN']).toBeTruthy()
      expect(clip.labels?.['en-US']).toBeTruthy()
    }
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

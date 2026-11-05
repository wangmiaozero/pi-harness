import { describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import { loadPetPack } from './pack'
import { TIBOT_ACTIONS, TIBOT_SHAPES, tibotPackId } from '@shared/pet/tibot'

const NAMES: Record<(typeof TIBOT_SHAPES)[number], string> = {
  circle: '圆形',
  rounded: '方圆',
  jelly: '软糖',
  triangle: '三角',
  star: '星星',
  ghost: '幽灵'
}

describe('tibot canvas packs', () => {
  it('loads one jelly pet per shape and no group pack', async () => {
    await expect(loadPetPack(path.resolve('resources/petpacks/tibot'))).rejects.toThrow()
    for (const shape of TIBOT_SHAPES) {
      const pack = await loadPetPack(path.resolve('resources/petpacks', tibotPackId(shape)))
      expect(pack.manifest.renderer).toBe('canvas')
      expect(pack.manifest.id).toBe(tibotPackId(shape))
      expect(pack.manifest.name).toBe(NAMES[shape])
      expect(Object.keys(pack.manifest.clips)).toEqual([...TIBOT_ACTIONS])
      expect(pack.manifest.clips.jump.loop).toBe(false)
      expect((await fs.readFile(path.join(pack.root, 'NOTICE.txt'), 'utf8')).trim().length).toBeGreaterThan(0)
    }
  })
})

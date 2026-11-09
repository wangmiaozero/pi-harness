import { describe, expect, it } from 'vitest'
import { validatePetPackManifest } from './pack'

function manifest() {
  return {
    id: 'sample',
    name: 'Sample',
    nameEn: 'Sample',
    author: 'wangmiao',
    version: '1.0.0',
    license: 'MIT',
    baseWidth: 128,
    baseHeight: 128,
    fps: 12,
    clips: {
      idle: { frames: 2, loop: true, frameDurationsMs: [80, 80] }
    } as Record<string, { frames: number; loop: boolean; frameDurationsMs?: number[] }>
  }
}

describe('pet pack manifest limits', () => {
  it('bounds the expanded catalog instead of allowing unlimited clips', () => {
    const value = manifest()
    value.clips = Object.fromEntries(
      Array.from({ length: 256 }, (_, index) => [`action-${index}`, { frames: 1, loop: false }])
    )
    expect(Object.keys(validatePetPackManifest(value).clips)).toHaveLength(256)
    value.clips['one-too-many'] = { frames: 1, loop: false }
    expect(() => validatePetPackManifest(value)).toThrow('clip count')
  })

  it.each([[0], [Infinity], [NaN], [-10], [10001], ['100']])(
    'rejects invalid frame timing %s',
    (value) => {
      const next = manifest()
      next.clips.idle.frameDurationsMs = [value as number, value as number]
      expect(() => validatePetPackManifest(next)).toThrow('durations')
    }
  )
})

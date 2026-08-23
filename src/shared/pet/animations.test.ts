import { describe, expect, it } from 'vitest'
import { resolvePetAnimation, singleFrameAnimation } from './animations'
import type { PetManifest } from './types'

const manifest: PetManifest = {
  id: 'engineer',
  name: 'Engineer',
  sprite: '/pet.png',
  frameWidth: 100,
  frameHeight: 100,
  columns: 1,
  rows: 1,
  accent: '#fff',
  animations: {
    idle: singleFrameAnimation('idle'),
    running: singleFrameAnimation('running'),
    jumping: singleFrameAnimation('jumping')
  }
}

describe('resolvePetAnimation', () => {
  it('uses exact animations when available', () => {
    expect(resolvePetAnimation(manifest, 'jumping')?.state).toBe('jumping')
  })

  it('uses the declared fallback chain without returning null', () => {
    expect(resolvePetAnimation(manifest, 'coding')?.state).toBe('running')
    expect(resolvePetAnimation(manifest, 'success')?.state).toBe('jumping')
    expect(resolvePetAnimation(manifest, 'sleeping')?.state).toBe('idle')
    expect(resolvePetAnimation(manifest, 'failed')?.state).toBe('idle')
  })
})

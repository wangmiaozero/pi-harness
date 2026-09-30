import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MACOS27_BACKGROUND,
  MACOS27_BACKGROUNDS,
  isMacOS27EffectBackground,
  normalizeMacOS27Background,
  normalizeMacOS27BackgroundImage
} from './macos27-background'

describe('macOS 27 backgrounds', () => {
  it('defaults to Liquid Ether', () => {
    expect(DEFAULT_MACOS27_BACKGROUND).toBe('liquid-ether')
    expect(normalizeMacOS27Background(undefined)).toBe('liquid-ether')
    expect(normalizeMacOS27Background('unknown')).toBe('liquid-ether')
  })

  it('accepts every supported background', () => {
    for (const background of MACOS27_BACKGROUNDS) {
      expect(normalizeMacOS27Background(background)).toBe(background)
    }
  })

  it('separates the local image mode from WebGL effects', () => {
    expect(isMacOS27EffectBackground('liquid-ether')).toBe(true)
    expect(isMacOS27EffectBackground('local-image')).toBe(false)
  })

  it('accepts supported image data URLs only', () => {
    expect(normalizeMacOS27BackgroundImage('data:image/png;base64,cG5n')).toBe(
      'data:image/png;base64,cG5n'
    )
    expect(normalizeMacOS27BackgroundImage('data:image/svg+xml;base64,PHN2Zz4=')).toBeNull()
    expect(normalizeMacOS27BackgroundImage('file:///tmp/background.png')).toBeNull()
  })
})

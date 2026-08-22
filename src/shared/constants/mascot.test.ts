import { describe, expect, it } from 'vitest'
import { DEFAULT_MASCOT_STYLE, MASCOT_STYLES, normalizeMascotStyle } from './mascot'

describe('mascot styles', () => {
  it('defaults to no mascot', () => {
    expect(DEFAULT_MASCOT_STYLE).toBe('none')
    expect(normalizeMascotStyle(undefined)).toBe('none')
    expect(normalizeMascotStyle('unknown')).toBe('none')
    expect(normalizeMascotStyle('longhair')).toBe('none')
  })

  it('accepts every supported style', () => {
    for (const style of MASCOT_STYLES) expect(normalizeMascotStyle(style)).toBe(style)
  })
})

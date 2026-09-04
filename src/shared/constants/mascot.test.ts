import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MASCOT_STYLE,
  MASCOT_STYLES,
  MASCOT_UNLOCK_ANSWER,
  isMascotUnlockAnswer,
  normalizeMascotStyle,
  resolveMascotStyle
} from './mascot'

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

  it('borrows the cockpit and noir study looks for maidWhite and office', () => {
    expect(resolveMascotStyle('maidWhite')).toBe('starshipCockpit')
    expect(resolveMascotStyle('office')).toBe('noirScholar')
    expect(resolveMascotStyle('starshipCockpit')).toBe('starshipCockpit')
    expect(resolveMascotStyle('none')).toBe('none')
  })

  it('accepts only the 1 KiB byte-count answer', () => {
    expect(MASCOT_UNLOCK_ANSWER).toBe('1024')
    expect(isMascotUnlockAnswer('1024')).toBe(true)
    expect(isMascotUnlockAnswer(' 1024 ')).toBe(true)
    expect(isMascotUnlockAnswer('1000')).toBe(false)
    expect(isMascotUnlockAnswer(1024)).toBe(false)
  })
})

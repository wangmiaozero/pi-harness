import { describe, expect, it } from 'vitest'
import type { PetPackManifest } from './desktop'
import {
  BUNDLED_PACK_ID,
  DEFAULT_DESKTOP_PET_SETTINGS,
  clipForState,
  defaultDesktopPetSettings,
  isProtectedPackId,
  normalizeDesktopPetSettings,
  resolveStateClip
} from './desktop'

function manifestFor(overrides: Partial<PetPackManifest> = {}): PetPackManifest {
  return {
    formatVersion: 1,
    id: 'test',
    name: 'Test',
    nameEn: 'Test',
    author: 'tester',
    version: '1.0.0',
    license: 'MIT',
    licenseFiles: ['LICENSE'],
    baseWidth: 200,
    baseHeight: 160,
    fps: 24,
    clips: {
      idle: { dir: 'clips/idle', frames: 2, loop: true },
      thinking: { dir: 'clips/thinking', frames: 2, loop: true }
    },
    ...overrides
  } as PetPackManifest
}

describe('defaultDesktopPetSettings', () => {
  it('keeps the default size at 100% and reduces legacy oversized values to 150%', () => {
    expect(defaultDesktopPetSettings().size).toBe(160)
    expect(normalizeDesktopPetSettings({ size: 320 }).size).toBe(240)
    expect(normalizeDesktopPetSettings({ size: 96 }).size).toBe(96)
  })

  it('starts disabled on the bundled pack', () => {
    expect(defaultDesktopPetSettings().enabled).toBe(false)
    expect(defaultDesktopPetSettings().activePackId).toBe(BUNDLED_PACK_ID)
    expect(DEFAULT_DESKTOP_PET_SETTINGS.enabled).toBe(false)
  })

  it('preserves an explicit enabled=true through normalization', () => {
    const restored = normalizeDesktopPetSettings({ enabled: true, activePackId: 'mypack' })
    expect(restored.enabled).toBe(true)
    expect(restored.activePackId).toBe('mypack')
  })

  it('falls back to safe defaults for invalid values', () => {
    expect(normalizeDesktopPetSettings(null).enabled).toBe(false)
    expect(normalizeDesktopPetSettings({ enabled: 'yes' }).enabled).toBe(false)
    expect(normalizeDesktopPetSettings({ activePackId: '../../etc' }).activePackId).toBe(
      BUNDLED_PACK_ID
    )
    expect(normalizeDesktopPetSettings({ activePackId: 42 }).activePackId).toBe(BUNDLED_PACK_ID)
  })
})

describe('isProtectedPackId', () => {
  it('protects the bundled id case-insensitively', () => {
    expect(isProtectedPackId('bigfish')).toBe(true)
    expect(isProtectedPackId('BigFish')).toBe(true)
    expect(isProtectedPackId(' other ')).toBe(false)
  })
})

describe('STATE_CLIP_MAP fallback chains', () => {
  it('degrades thinking → working → idle', () => {
    expect(clipForState('thinking')).toEqual(['thinking', 'working', 'idle'])
    expect(clipForState('tool-calling')).toEqual([
      'working_command',
      'working_search',
      'working',
      'idle'
    ])
  })

  it('degrades success/error to idle', () => {
    expect(clipForState('success')).toEqual(['success', 'idle'])
    expect(clipForState('failed')).toEqual(['error', 'idle'])
  })

  it('falls back to idle for unknown states', () => {
    expect(clipForState('unknown-state')).toEqual(['idle'])
  })
})

describe('resolveStateClip', () => {
  it('prefers the declared agentStateMapping', () => {
    const manifest = manifestFor({
      agentStateMapping: { thinking: 'idle' }
    })
    expect(resolveStateClip(manifest, 'thinking')).toBe('idle')
  })

  it('ignores an agentStateMapping that points to an undeclared clip', () => {
    const manifest = manifestFor({
      agentStateMapping: { thinking: 'no-such-clip' }
    })
    expect(resolveStateClip(manifest, 'thinking')).toBe('thinking')
  })

  it('walks the shared fallback chain (thinking → working → idle)', () => {
    const manifest = manifestFor({
      clips: { idle: { dir: 'clips/idle', frames: 1, loop: true } }
    })
    expect(resolveStateClip(manifest, 'thinking')).toBe('idle')
  })

  it('uses the pack defaultAnimation when no chain clip exists', () => {
    const manifest = manifestFor({
      defaultAnimation: 'breathe',
      clips: { breathe: { dir: 'clips/breathe', frames: 1, loop: true } }
    })
    expect(resolveStateClip(manifest, 'thinking')).toBe('breathe')
  })

  it('falls back to the first declared clip for a single-animation pack', () => {
    const manifest = manifestFor({
      clips: { hop: { dir: 'hop', frames: 1, loop: true } }
    })
    expect(resolveStateClip(manifest, 'success')).toBe('hop')
    expect(resolveStateClip(manifest, 'failed')).toBe('hop')
  })
})

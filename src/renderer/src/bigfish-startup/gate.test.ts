import { describe, expect, it } from 'vitest'
import { BUNDLED_PACK_ID } from '@shared/pet/desktop'
import { usesBigfishStartup } from './gate'

const enabled = {
  desktopPet: { enabled: true, activePackId: BUNDLED_PACK_ID, reducedMotion: false }
}

describe('bigfish startup gate', () => {
  it('plays when 大肥鱼 is selected and the desktop pet is on', () => {
    expect(usesBigfishStartup(enabled)).toBe(true)
  })

  it('stays off when the pet is disabled or another pack is selected', () => {
    expect(usesBigfishStartup({ desktopPet: { ...enabled.desktopPet, enabled: false } })).toBe(
      false
    )
    expect(usesBigfishStartup({ desktopPet: { ...enabled.desktopPet, activePackId: 'samplepet' } })).toBe(
      false
    )
    expect(usesBigfishStartup(null)).toBe(false)
    expect(usesBigfishStartup({})).toBe(false)
  })

  it('stays off for nomascot builds and reduced motion', () => {
    expect(usesBigfishStartup(enabled, { mascotEnabled: false })).toBe(false)
    expect(usesBigfishStartup(enabled, { reducedMotion: true })).toBe(false)
    expect(
      usesBigfishStartup({ desktopPet: { ...enabled.desktopPet, reducedMotion: true } })
    ).toBe(false)
  })
})

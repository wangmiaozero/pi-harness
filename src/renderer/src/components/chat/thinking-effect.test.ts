import { afterEach, describe, expect, it } from 'vitest'
import { thinkingEffectPalette } from './thinking-effect'

afterEach(() => {
  delete document.documentElement.dataset.visualSkin
})

describe('thinking effect palette', () => {
  it('uses cinnabar-gold embers for Ming skins', () => {
    document.documentElement.dataset.visualSkin = 'ming-snow'
    const ming = thinkingEffectPalette()
    expect(ming.kind).toBe('embers')
    expect(ming.deep[0]).toBeGreaterThan(ming.deep[2])

    document.documentElement.dataset.visualSkin = 'starship-cockpit'
    const ship = thinkingEffectPalette()
    expect(ship.kind).toBe('stars')
    expect(ship.deep[2]).toBeGreaterThan(ship.deep[0])
  })
})

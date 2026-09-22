import { describe, expect, it } from 'vitest'
import { isMingDynastyTheme, normalizeAppIconPreference, resolveAppIcon } from './app-icon'

describe('application icon selection', () => {
  it('uses the classic icon by default and Ming only for active Ming themes', () => {
    expect(resolveAppIcon('auto', false)).toBe('classic')
    expect(resolveAppIcon('auto', isMingDynastyTheme('mingSnow', true))).toBe('ming')
    expect(resolveAppIcon('auto', isMingDynastyTheme('mingMoon', true))).toBe('ming')
    expect(resolveAppIcon('auto', isMingDynastyTheme('mingMoon', false))).toBe('classic')
    expect(resolveAppIcon('auto', isMingDynastyTheme('office', true))).toBe('classic')
    expect(resolveAppIcon('auto', isMingDynastyTheme('mingSnow', true, false))).toBe('classic')
  })

  it('keeps manual choices independent of the theme', () => {
    expect(resolveAppIcon('quantum', true)).toBe('quantum')
    expect(resolveAppIcon('ming', false)).toBe('ming')
    expect(normalizeAppIconPreference('unexpected')).toBe('auto')
  })
})

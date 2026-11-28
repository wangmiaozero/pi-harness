import { describe, expect, it, vi } from 'vitest'
import { chooseStartupScheme, createStartupSelector, startupOverride } from './startup-selection'

describe('cold startup selection', () => {
  it.each([
    [0, 'legacy'],
    [0.499999, 'legacy'],
    [0.5, 'flow'],
    [0.999999, 'flow']
  ])('maps %s to %s', (value, scheme) => {
    expect(chooseStartupScheme(() => value as number)).toBe(scheme)
  })

  it('makes one decision per app process and skips subsequent windows', () => {
    const random = vi.fn(() => 0.5)
    const select = createStartupSelector(random)
    expect(select()).toBe('flow')
    expect(select()).toBe('0')
    expect(select('legacy')).toBe('0')
    expect(random).toHaveBeenCalledTimes(1)
  })

  it('forces a branch only for development and isolated tests', () => {
    const random = vi.fn(() => 0)
    expect(startupOverride('flow', false, false)).toBeUndefined()
    expect(startupOverride('flow', true, false)).toBe('flow')
    expect(startupOverride(undefined, false, true)).toBe('legacy')
    expect(createStartupSelector(random)(startupOverride('flow', false, true))).toBe('flow')
    expect(random).not.toHaveBeenCalled()
  })
})

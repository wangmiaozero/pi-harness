import { describe, expect, it } from 'vitest'
import { parseMarketPackageName } from './package-name'

describe('official market package names', () => {
  it.each([
    '@piharness/theme-deepseek',
    '@piharness/theme-maid-white',
    '@piharness/pet-bigfish',
    '@piharness/pet-jelly'
  ])('accepts %s', (name) => {
    expect(parseMarketPackageName(name)?.name).toBe(name)
  })

  it.each([
    '@piharness/theme',
    '@piharness/theme-',
    '@piharness/theme-DeepSeek',
    '@piharness/theme_deepseek',
    '@piharness/other-deepseek',
    'pi-harness/theme-deepseek',
    '@pi-harness/theme-deepseek',
    '@piharness/theme-deepseek/extra',
    '@piharness/themepack-deepseek'
  ])('rejects %s', (name) => {
    expect(parseMarketPackageName(name)).toBeNull()
  })
})

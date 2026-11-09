import { describe, expect, it } from 'vitest'
import { parseMarketPackageName } from './package-name'

describe('official market package names', () => {
  it.each([
    '@pi-harness/theme-deepseek',
    '@pi-harness/theme-maid-white',
    '@pi-harness/pet-bigfish',
    '@pi-harness/pet-jelly'
  ])('accepts %s', (name) => {
    expect(parseMarketPackageName(name)?.name).toBe(name)
  })

  it.each([
    '@pi-harness/theme',
    '@pi-harness/theme-',
    '@pi-harness/theme-DeepSeek',
    '@pi-harness/theme_deepseek',
    '@pi-harness/other-deepseek',
    'pi-harness/theme-deepseek',
    '@piharness/theme-deepseek',
    '@pi-harness/theme-deepseek/extra',
    '@pi-harness/themepack-deepseek'
  ])('rejects %s', (name) => {
    expect(parseMarketPackageName(name)).toBeNull()
  })
})

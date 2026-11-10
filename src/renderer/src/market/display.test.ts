import { describe, expect, it } from 'vitest'
import { actionPackInfo, compareMarketPackageNames, humanizeSlug, localizedText, packageDisplayName } from './display'

const t = (key: string, values: Record<string, unknown>) => `${key}:${values.name}:${values.index}`

describe('market display helpers', () => {
  it('derives readable names from package names', () => {
    expect(packageDisplayName('@piharness/theme-deepseek', 'en-US', t)).toBe('DeepSeek')
    expect(packageDisplayName('@piharness/theme-noir-scholar', 'en-US', t)).toBe('Noir Scholar')
    expect(humanizeSlug('ming-moon')).toBe('Ming Moon')
  })

  it('prefers the installed manifest name and localizes it', () => {
    expect(packageDisplayName('@piharness/theme-deepseek', 'zh-CN', t, '深海 / Deep Sea')).toBe('深海')
    expect(packageDisplayName('@piharness/theme-deepseek', 'fr-FR', t, '深海 / Deep Sea')).toBe(
      'Deep Sea'
    )
  })

  it('names pet action packs after their main pet', () => {
    expect(actionPackInfo('@piharness/pet-bigfish-2')).toEqual({
      parent: '@piharness/pet-bigfish',
      index: 2
    })
    expect(actionPackInfo('@piharness/pet-bigfish')).toBeNull()
    expect(actionPackInfo('@piharness/theme-deepseek-2')).toBeNull()
    expect(packageDisplayName('@piharness/pet-bigfish-3', 'en-US', t)).toBe(
      'settings.marketActionPackName:BigFish:3'
    )
  })

  it('picks the description half that matches the locale', () => {
    expect(localizedText('蓝发女仆 / Blue maid', 'zh-TW')).toBe('蓝发女仆')
    expect(localizedText('蓝发女仆 / Blue maid', 'ja-JP')).toBe('Blue maid')
    expect(localizedText('Only one language', 'zh-CN')).toBe('Only one language')
    expect(localizedText('a / b / c', 'en-US')).toBe('a / b / c')
  })

  it('sorts action packs in natural numeric order after their main pet', () => {
    const names = [
      '@piharness/pet-bigfish-10',
      '@piharness/pet-bigfish-2',
      '@piharness/pet-bigfish',
      '@piharness/pet-bigfish-1',
      '@piharness/pet-bigfish-20'
    ]
    expect([...names].sort(compareMarketPackageNames)).toEqual([
      '@piharness/pet-bigfish',
      '@piharness/pet-bigfish-1',
      '@piharness/pet-bigfish-2',
      '@piharness/pet-bigfish-10',
      '@piharness/pet-bigfish-20'
    ])
  })
})

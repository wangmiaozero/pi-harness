import { describe, expect, it } from 'vitest'
import { BUNDLED_PACK_ID } from '@shared/pet/desktop'
import {
  deepseekVideoPlacement,
  finaleLineKey,
  startupBrandCopy,
  usesBigfishStartup,
  usesDeepseekVideoSkin,
  usesDeepseekVideoStartup,
  usesPortraitWelcomeStartup
} from './gate'

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
    expect(
      usesBigfishStartup({ desktopPet: { ...enabled.desktopPet, activePackId: 'samplepet' } })
    ).toBe(false)
    expect(usesBigfishStartup(null)).toBe(false)
    expect(usesBigfishStartup({})).toBe(false)
  })

  it('adds the video boot only for DeepSeek and DeepSeek Pro', () => {
    expect(usesDeepseekVideoStartup({ mascotStyle: 'ropeDeepseek', mascotUnlocked: true })).toBe(
      true
    )
    expect(usesDeepseekVideoStartup({ mascotStyle: 'ropeWhale', mascotUnlocked: true })).toBe(true)
    for (const mascotStyle of ['ropeClaude', 'ropePhoebe', 'ropeQwen', 'none'] as const) {
      expect(usesDeepseekVideoStartup({ mascotStyle, mascotUnlocked: true })).toBe(false)
    }
    expect(usesDeepseekVideoStartup({ mascotStyle: 'ropeDeepseek', mascotUnlocked: false })).toBe(
      false
    )
    expect(
      usesDeepseekVideoStartup(
        { mascotStyle: 'ropeWhale', mascotUnlocked: true },
        { reducedMotion: true }
      )
    ).toBe(false)
    expect(usesDeepseekVideoSkin({ mascotStyle: 'ropeDeepseek', mascotUnlocked: true })).toBe(true)
    expect(usesDeepseekVideoSkin({ mascotStyle: 'ropeWhale', mascotUnlocked: true })).toBe(true)
    expect(usesDeepseekVideoSkin({ mascotStyle: 'ropeClaude', mascotUnlocked: true })).toBe(false)
    expect(usesDeepseekVideoSkin({ mascotStyle: 'ropeDeepseek', mascotUnlocked: false })).toBe(
      false
    )
    expect(
      usesDeepseekVideoSkin({
        mascotStyle: 'ropeDeepseek',
        mascotUnlocked: true,
        customSkinId: 'custom-test'
      })
    ).toBe(false)
    expect(deepseekVideoPlacement(0)).toBe('only')
    expect(deepseekVideoPlacement(0.49)).toBe('only')
    expect(deepseekVideoPlacement(0.5)).toBe('after')
    expect(deepseekVideoPlacement(0.99)).toBe('after')
  })

  it('plays the current boot sequence for every rope portrait except Phoebe', () => {
    for (const mascotStyle of [
      'ropeWhale',
      'ropeDeepseek',
      'ropeClaude',
      'ropeGemini',
      'ropeGpt',
      'ropeGlm',
      'ropeGrok',
      'ropeKimi',
      'ropeQwen'
    ] as const) {
      expect(usesPortraitWelcomeStartup({ mascotStyle, mascotUnlocked: true })).toBe(true)
    }
    expect(usesPortraitWelcomeStartup({ mascotStyle: 'ropePhoebe', mascotUnlocked: true })).toBe(
      false
    )
    expect(usesPortraitWelcomeStartup({ mascotStyle: 'ropeClaude', mascotUnlocked: false })).toBe(
      false
    )
    expect(
      usesPortraitWelcomeStartup(
        { mascotStyle: 'ropeClaude', mascotUnlocked: true },
        { reducedMotion: true }
      )
    ).toBe(false)
  })

  it('keeps the original finale for DeepSeek and swaps line-6 for the other portraits', () => {
    expect(finaleLineKey('ropeDeepseek')).toBe('line-6')
    expect(finaleLineKey('ropeWhale')).toBe('line-6')
    expect(finaleLineKey('ropePhoebe')).toBe('line-6')
    expect(finaleLineKey('ropeClaude')).toBe('line-6-claude')
    expect(finaleLineKey('ropeGemini')).toBe('line-6-gemini')
    expect(finaleLineKey('ropeGpt')).toBe('line-6-gpt')
    expect(finaleLineKey('ropeGlm')).toBe('line-6-glm')
    expect(finaleLineKey('ropeGrok')).toBe('line-6-grok')
    expect(finaleLineKey('ropeKimi')).toBe('line-6-kimi')
    expect(finaleLineKey('ropeQwen')).toBe('line-6-qwen')
  })

  it('replaces the DeepSeek copy for the seven named portraits', () => {
    expect(startupBrandCopy('ropeDeepseek')).toBeNull()
    expect(startupBrandCopy('ropeWhale')).toBeNull()
    expect(startupBrandCopy('ropePhoebe')).toBeNull()
    expect(startupBrandCopy('ropeClaude')).toEqual({
      brand1: 'CLAUDE',
      orgZh: 'Claude Code',
      orgEn: '',
      orgSub: 'CLAUDE HARNESS',
      welcomeBox: 'CLAUDE HARNESS',
      footer: 'POWERED BY CLAUDE'
    })
    expect(startupBrandCopy('ropeGemini')?.orgZh).toBe('Google Gemini')
    expect(startupBrandCopy('ropeGpt')?.orgZh).toBe('ChatGPT')
    expect(startupBrandCopy('ropeGlm')?.orgZh).toBe('智谱 GLM')
    expect(startupBrandCopy('ropeGrok')?.orgZh).toBe('xAI Grok')
    expect(startupBrandCopy('ropeKimi')?.orgZh).toBe('月之暗面 Kimi')
    expect(startupBrandCopy('ropeQwen')?.orgZh).toBe('通义千问')
    for (const style of [
      'ropeClaude',
      'ropeGemini',
      'ropeGpt',
      'ropeGlm',
      'ropeGrok',
      'ropeKimi',
      'ropeQwen'
    ] as const) {
      const copy = startupBrandCopy(style)
      expect(copy?.orgEn).toBe('')
      expect(copy?.orgZh.toUpperCase()).not.toBe(copy?.brand1)
    }
  })

  it('stays off for nomascot builds and reduced motion', () => {
    expect(usesBigfishStartup(enabled, { mascotEnabled: false })).toBe(false)
    expect(usesBigfishStartup(enabled, { reducedMotion: true })).toBe(false)
    expect(usesBigfishStartup({ desktopPet: { ...enabled.desktopPet, reducedMotion: true } })).toBe(
      false
    )
  })
})

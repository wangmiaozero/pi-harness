import { describe, it, expect } from 'vitest'
import { piSettingsConfigSchema } from '@shared/schemas/pi'

describe('piSettingsConfigSchema', () => {
  it('accepts Pi 0.83-style null placeholders', () => {
    const r = piSettingsConfigSchema.safeParse({
      defaultProvider: 'stepfun-plan',
      defaultModel: 'step-3.7-flash',
      defaultThinkingLevel: null,
      theme: 'dark',
      enabledModels: null,
      defaultProjectTrust: null,
      enableSkillCommands: null,
      packages: null,
      extensions: null,
      skills: null,
      prompts: null,
      themes: null,
      compaction: null,
      retry: null,
      markdown: null,
      warnings: null,
      terminal: { showImages: true },
      lastChangelogVersion: '0.83.0'
    })
    expect(r.success).toBe(true)
  })

  it('still rejects invalid thinking level strings', () => {
    const r = piSettingsConfigSchema.safeParse({
      defaultThinkingLevel: 'ultra'
    })
    expect(r.success).toBe(false)
  })
})

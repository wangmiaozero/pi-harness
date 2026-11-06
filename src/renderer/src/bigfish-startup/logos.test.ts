import { describe, expect, it } from 'vitest'
import { startupLogo } from './logos'

describe('startupLogo', () => {
  it('keeps the whale for DeepSeek and DeepSeek Pro', () => {
    expect(startupLogo('ropeDeepseek')).toBeNull()
    expect(startupLogo('ropeWhale')).toBeNull()
    expect(startupLogo('ropePhoebe')).toBeNull()
    expect(startupLogo(undefined)).toBeNull()
  })

  it('gives the other seven portraits their own mark', () => {
    for (const style of [
      'ropeClaude',
      'ropeGemini',
      'ropeGpt',
      'ropeGlm',
      'ropeGrok',
      'ropeKimi',
      'ropeQwen'
    ] as const) {
      const logo = startupLogo(style)
      expect(logo?.viewBox).toBe('0 0 24 24')
      expect(logo?.paths.length).toBeGreaterThan(0)
    }
    expect(startupLogo('ropeKimi')?.paths).toHaveLength(2)
  })
})

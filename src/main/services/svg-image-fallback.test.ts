import { describe, expect, it } from 'vitest'
import {
  extractChatCompletionText,
  sanitizeGeneratedSvg,
  svgFallbackPrompt
} from './svg-image-fallback'

describe('SVG image fallback', () => {
  it('extracts and constrains a generated SVG', () => {
    const svg = sanitizeGeneratedSvg(
      '```svg\n<svg width="10"><defs><linearGradient id="sky"><stop offset="0" stop-color="#fff"/></linearGradient></defs><rect width="10" height="10" fill="url(#sky)"/></svg>\n```',
      1024,
      768
    )

    expect(svg).toContain('width="1024"')
    expect(svg).toContain('height="768"')
    expect(svg).toContain('viewBox="0 0 1024 768"')
    expect(svg).toContain('fill="url(#sky)"')
  })

  it('rejects executable SVG elements', () => {
    expect(() =>
      sanitizeGeneratedSvg('<svg><script>alert(1)</script></svg>', 1024, 1024)
    ).toThrow('unsupported element')
  })

  it('removes external references and event handlers', () => {
    const svg = sanitizeGeneratedSvg(
      '<svg><rect width="10" height="10" onclick="alert(1)" fill="url(https://bad.test/a)"/></svg>',
      10,
      10
    )
    expect(svg).not.toContain('onclick')
    expect(svg).not.toContain('bad.test')
  })

  it('builds a dimensioned prompt and reads text responses', () => {
    expect(svgFallbackPrompt('moon palace', 1360, 768)).toContain('0 0 1360 768')
    expect(
      extractChatCompletionText({ choices: [{ message: { content: '<svg></svg>' } }] })
    ).toBe('<svg></svg>')
  })
})

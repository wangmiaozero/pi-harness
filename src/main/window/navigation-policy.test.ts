import { describe, expect, it } from 'vitest'
import { isAllowedRendererNavigation } from './navigation-policy'

describe('isAllowedRendererNavigation', () => {
  it('allows only the configured development origin', () => {
    const rendererUrl = 'http://localhost:5173/'

    expect(isAllowedRendererNavigation('http://localhost:5173/workspace', rendererUrl)).toBe(true)
    expect(isAllowedRendererNavigation('http://localhost.evil.test:5173/', rendererUrl)).toBe(false)
    expect(isAllowedRendererNavigation('http://127.0.0.1:5173/', rendererUrl)).toBe(false)
  })

  it('allows only the packaged renderer file while permitting hash routes', () => {
    const rendererUrl = 'file:///Applications/Pi-Harness/renderer/index.html'

    expect(isAllowedRendererNavigation(`${rendererUrl}#/workspace`, rendererUrl)).toBe(true)
    expect(
      isAllowedRendererNavigation('file:///Users/example/untrusted/index.html', rendererUrl)
    ).toBe(false)
  })

  it('rejects malformed URLs', () => {
    expect(isAllowedRendererNavigation('not a URL', 'file:///app/index.html')).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { isAllowedRendererNavigation } from './navigation-policy'

describe('isAllowedRendererNavigation', () => {
  it('allows only the configured development origin', () => {
    const rendererUrl = 'http://localhost:31415/'

    expect(isAllowedRendererNavigation('http://localhost:31415/workspace', rendererUrl)).toBe(true)
    expect(isAllowedRendererNavigation('http://localhost.evil.test:31415/', rendererUrl)).toBe(false)
    expect(isAllowedRendererNavigation('http://127.0.0.1:31415/', rendererUrl)).toBe(false)
  })

  it('allows only the packaged renderer file while permitting hash routes', () => {
    const rendererUrl = 'file:///Applications/Pi-Harness/renderer/index.html'

    expect(isAllowedRendererNavigation(`${rendererUrl}#/workspace`, rendererUrl)).toBe(true)
    expect(
      isAllowedRendererNavigation('file:///Users/example/untrusted/index.html', rendererUrl)
    ).toBe(false)
  })

  it('allows only the packaged overlay renderer for the overlay window', () => {
    const rendererUrl = 'file:///Applications/Pi-Harness/renderer/overlay.html'

    expect(isAllowedRendererNavigation(rendererUrl, rendererUrl)).toBe(true)
    expect(
      isAllowedRendererNavigation('file:///Applications/Pi-Harness/renderer/index.html', rendererUrl)
    ).toBe(false)
  })

  it('rejects malformed URLs', () => {
    expect(isAllowedRendererNavigation('not a URL', 'file:///app/index.html')).toBe(false)
  })
})

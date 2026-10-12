import { expect, it } from 'vitest'
import type { WebContents } from 'electron'
import {
  canUseArchitectureFullscreen,
  setArchitectureFullscreenAllowed
} from './fullscreen-permission'

it('allows fullscreen only for the visible architecture host main frame and revokes it when hidden', () => {
  let url = 'file:///app/index.html#/workspace'
  const owner = { getURL: () => url, isDestroyed: () => false } as WebContents
  const other = { getURL: () => url, isDestroyed: () => false } as WebContents
  const details = { isMainFrame: true, requestingUrl: url }
  expect(canUseArchitectureFullscreen(owner, 'fullscreen', details)).toBe(false)
  setArchitectureFullscreenAllowed(owner, true)
  expect(canUseArchitectureFullscreen(owner, 'fullscreen', details)).toBe(true)
  for (const permission of ['automatic-fullscreen', 'media', 'geolocation', 'clipboard-read'])
    expect(canUseArchitectureFullscreen(owner, permission, details)).toBe(false)
  expect(canUseArchitectureFullscreen(other, 'fullscreen', details)).toBe(false)
  expect(
    canUseArchitectureFullscreen(owner, 'fullscreen', { ...details, isMainFrame: false })
  ).toBe(false)
  expect(
    canUseArchitectureFullscreen(owner, 'fullscreen', {
      ...details,
      requestingUrl: 'https://example.invalid'
    })
  ).toBe(false)
  url = 'https://example.invalid'
  expect(
    canUseArchitectureFullscreen(owner, 'fullscreen', { ...details, requestingUrl: url })
  ).toBe(false)
  url = details.requestingUrl
  setArchitectureFullscreenAllowed(owner, false)
  expect(canUseArchitectureFullscreen(owner, 'fullscreen', details)).toBe(false)
})

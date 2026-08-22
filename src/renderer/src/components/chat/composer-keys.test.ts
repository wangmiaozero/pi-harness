import { describe, expect, it } from 'vitest'
import { shouldSendComposerKey, type ComposerKeyEvent } from './composer-keys'

function keyEvent(overrides: Partial<ComposerKeyEvent> = {}): ComposerKeyEvent {
  return {
    key: 'Enter',
    shiftKey: false,
    isComposing: false,
    keyCode: 13,
    ...overrides
  }
}

describe('composer keyboard behavior', () => {
  it('sends on Enter', () => {
    expect(shouldSendComposerKey(keyEvent())).toBe(true)
  })

  it('keeps Shift+Enter for a newline', () => {
    expect(shouldSendComposerKey(keyEvent({ shiftKey: true }))).toBe(false)
  })

  it('does not send while an input method is confirming text', () => {
    expect(shouldSendComposerKey(keyEvent({ isComposing: true }))).toBe(false)
    expect(shouldSendComposerKey(keyEvent({ keyCode: 229 }))).toBe(false)
  })

  it('ignores non-Enter keys', () => {
    expect(shouldSendComposerKey(keyEvent({ key: 'a', keyCode: 65 }))).toBe(false)
  })
})

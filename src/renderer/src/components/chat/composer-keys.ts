export interface ComposerKeyEvent {
  key: string
  shiftKey: boolean
  isComposing: boolean
  keyCode: number
}

/** Enter sends; Shift+Enter inserts a newline. IME confirmation must never send. */
export function shouldSendComposerKey(event: ComposerKeyEvent): boolean {
  return event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229
}

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  installShortcutListener,
  matchShortcut,
  registerShortcut,
  setShortcutOverrides
} from './shortcuts'
const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  setShortcutOverrides({})
  document.body.innerHTML = ''
})
describe('custom keyboard shortcuts', () => {
  it('uses configured bindings and stops matching the replaced defaults', () => {
    cleanups.push(
      registerShortcut({ id: 'settings', label: 'Settings', keys: ['meta+,'], run: vi.fn() })
    )
    setShortcutOverrides({ settings: ['meta+g'] })
    expect(matchShortcut(new KeyboardEvent('keydown', { key: ',', metaKey: true }))).toBeNull()
    expect(matchShortcut(new KeyboardEvent('keydown', { key: 'g', metaKey: true }))?.id).toBe(
      'settings'
    )
    setShortcutOverrides({ settings: [] })
    expect(matchShortcut(new KeyboardEvent('keydown', { key: 'g', metaKey: true }))).toBeNull()
  })
  it('allows customized global controls in an input and ignores composing, repeated and handled events', () => {
    const run = vi.fn()
    cleanups.push(registerShortcut({ id: 'settings', label: 'Settings', keys: ['meta+,'], run }))
    cleanups.push(installShortcutListener())
    setShortcutOverrides({ settings: ['meta+g'] })
    const input = document.createElement('input')
    document.body.append(input)
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'g', metaKey: true, bubbles: true, cancelable: true })
    )
    expect(run).toHaveBeenCalledOnce()
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'g', metaKey: true, bubbles: true, isComposing: true })
    )
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'g', metaKey: true, bubbles: true, repeat: true })
    )
    const handled = new KeyboardEvent('keydown', {
      key: 'g',
      metaKey: true,
      bubbles: true,
      cancelable: true
    })
    handled.preventDefault()
    input.dispatchEvent(handled)
    expect(run).toHaveBeenCalledOnce()
  })
})

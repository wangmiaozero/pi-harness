import { SHORTCUT_DEFAULTS, type ShortcutId } from '@shared/agent-settings/schema'
/**
 * Keyboard shortcut registry — single place for global shortcuts.
 */

export interface ShortcutBinding {
  id: string
  /** Display label */
  label: string
  /** e.g. 'meta+k', 'ctrl+k', 'meta+,' */
  keys: string[]
  run: () => void
}

let overrides: Partial<Record<ShortcutId, string[]>> = {}
export function setShortcutOverrides(value: Partial<Record<ShortcutId, string[]>> = {}): void {
  overrides = value
}
export function shortcutKeys(id: string, fallback: readonly string[] = []): readonly string[] {
  return overrides[id as ShortcutId] ?? SHORTCUT_DEFAULTS[id as ShortcutId] ?? fallback
}

const bindings = new Map<string, ShortcutBinding>()

export function normalizeChord(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.metaKey) parts.push('meta')
  if (e.ctrlKey) parts.push('ctrl')
  if (e.altKey) parts.push('alt')
  if (e.shiftKey) parts.push('shift')
  const key = (e.code === 'Comma' ? ',' : e.key).toLowerCase()
  if (!['meta', 'control', 'alt', 'shift'].includes(key)) parts.push(key)
  return parts.join('+')
}

export function registerShortcut(binding: ShortcutBinding): () => void {
  bindings.set(binding.id, binding)
  return () => bindings.delete(binding.id)
}

export function listShortcuts(): ShortcutBinding[] {
  return [...bindings.values()].map((binding) => ({
    ...binding,
    keys: [...shortcutKeys(binding.id, binding.keys)]
  }))
}

export function matchShortcut(e: KeyboardEvent): ShortcutBinding | null {
  const chord = normalizeChord(e)
  for (const b of bindings.values()) {
    if (shortcutKeys(b.id, b.keys).includes(chord)) return b
  }
  return null
}

export function installShortcutListener(): () => void {
  const handler = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.isComposing || e.repeat) return
    const target = e.target as HTMLElement | null
    const tag = target?.tagName?.toLowerCase()
    const editable =
      tag === 'input' ||
      tag === 'textarea' ||
      tag === 'select' ||
      target?.isContentEditable ||
      target?.closest?.('.cm-editor')
    // Allow palette + settings even in inputs; block others
    const chord = normalizeChord(e)
    const isGlobal =
      shortcutKeys('command-palette').includes(chord) || shortcutKeys('settings').includes(chord)
    if (editable && !isGlobal) return

    const hit = matchShortcut(e)
    if (hit) {
      e.preventDefault()
      hit.run()
    }
  }
  window.addEventListener('keydown', handler)
  return () => window.removeEventListener('keydown', handler)
}

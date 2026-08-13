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

const bindings = new Map<string, ShortcutBinding>()

function normalizeChord(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.metaKey) parts.push('meta')
  if (e.ctrlKey) parts.push('ctrl')
  if (e.altKey) parts.push('alt')
  if (e.shiftKey) parts.push('shift')
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase()
  if (!['meta', 'control', 'alt', 'shift'].includes(key)) parts.push(key)
  return parts.join('+')
}

export function registerShortcut(binding: ShortcutBinding): () => void {
  bindings.set(binding.id, binding)
  return () => bindings.delete(binding.id)
}

export function listShortcuts(): ShortcutBinding[] {
  return [...bindings.values()]
}

export function matchShortcut(e: KeyboardEvent): ShortcutBinding | null {
  const chord = normalizeChord(e)
  for (const b of bindings.values()) {
    if (b.keys.includes(chord)) return b
  }
  return null
}

export function installShortcutListener(): () => void {
  const handler = (e: KeyboardEvent) => {
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
      chord === 'meta+k' || chord === 'ctrl+k' || chord === 'meta+,' || chord === 'ctrl+,'
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

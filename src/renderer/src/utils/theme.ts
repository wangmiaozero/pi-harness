/**
 * Theme application — Graphite dark + light semantic tokens via data-theme.
 */

export type ThemePreference = 'system' | 'dark' | 'light'

function systemPrefersDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true
}

export function resolveTheme(pref: ThemePreference): 'dark' | 'light' {
  if (pref === 'system') return systemPrefersDark() ? 'dark' : 'light'
  return pref
}

export function applyTheme(pref: ThemePreference): void {
  const resolved = resolveTheme(pref)
  document.documentElement.dataset.theme = resolved
  document.documentElement.style.colorScheme = resolved
}

let mediaListener: ((e: MediaQueryListEvent) => void) | null = null

export function watchSystemTheme(pref: ThemePreference): void {
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
  if (!mq) return
  if (mediaListener) mq.removeEventListener('change', mediaListener)
  mediaListener = () => {
    if (pref === 'system') applyTheme('system')
  }
  mq.addEventListener('change', mediaListener)
  applyTheme(pref)
}

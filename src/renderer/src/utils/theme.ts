/**
 * Theme application — Graphite dark + light semantic tokens via data-theme,
 * plus a user-selectable accent color via data-accent.
 */

import type { AccentColor } from '@shared/ipc/api-types'

export type ThemePreference = 'system' | 'dark' | 'light'

type AccentPreset = Exclude<AccentColor, 'custom'>

/** 预设强调色及设置面板使用的色板。 */
export const ACCENT_COLORS: ReadonlyArray<{ id: AccentPreset; swatch: string }> = [
  { id: 'blue', swatch: '#5b91f5' },
  { id: 'purple', swatch: '#a78bfa' },
  { id: 'pink', swatch: '#f472b6' },
  { id: 'red', swatch: '#f87171' },
  { id: 'orange', swatch: '#fb923c' },
  { id: 'yellow', swatch: '#eab308' },
  { id: 'green', swatch: '#34d399' },
  { id: 'graphite', swatch: '#8a919e' }
]

/** 将 #rgb / #rrggbb 解析为 “r, g, b” 字符串，失败返回 null。 */
function hexToRgbTriplet(hex: string): string | null {
  const raw = hex.trim().replace(/^#/, '')
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null
  const n = parseInt(full, 16)
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`
}

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

export function applyAccent(accent: AccentColor | undefined | null, customHex?: string): void {
  const root = document.documentElement
  if (accent === 'custom') {
    /* 自定义色：内联注入 --accent-rgb，hover/active 由 CSS color-mix 按主题生成 */
    const rgb = hexToRgbTriplet(customHex ?? '#5b91f5')
    if (rgb) root.style.setProperty('--accent-rgb', rgb)
    root.dataset.accent = 'custom'
    return
  }
  /* 预设色：移除内联覆盖，回退到 data-accent 的静态调色板 */
  root.style.removeProperty('--accent-rgb')
  root.dataset.accent = accent ?? 'blue'
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

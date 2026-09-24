export type ThinkingParticleKind = 'embers' | 'stars' | 'motes'

export interface ThinkingEffectPalette {
  kind: ThinkingParticleKind
  wash: [number, number, number, number]
  deep: [number, number, number]
  mid: [number, number, number]
  hot: [number, number, number]
  particle: [number, number, number]
}

const PALETTES: Record<string, ThinkingEffectPalette> = {
  'ming-snow': {
    kind: 'embers',
    wash: [0.15, 0.11, 0.08, 0.58],
    deep: [0.62, 0.18, 0.16],
    mid: [0.82, 0.42, 0.2],
    hot: [0.98, 0.86, 0.58],
    particle: [0.93, 0.74, 0.42]
  },
  'ming-moon': {
    kind: 'embers',
    wash: [0.12, 0.08, 0.08, 0.6],
    deep: [0.62, 0.16, 0.16],
    mid: [0.79, 0.41, 0.34],
    hot: [0.98, 0.82, 0.62],
    particle: [0.9, 0.52, 0.4]
  },
  'starship-cockpit': {
    kind: 'stars',
    wash: [0.06, 0.09, 0.16, 0.62],
    deep: [0.082, 0.365, 0.988],
    mid: [0.318, 0.635, 1],
    hot: [0.741, 0.867, 1],
    particle: [1, 1, 1]
  },
  'maid-white': {
    kind: 'motes',
    wash: [0.86, 0.91, 0.98, 0.42],
    deep: [0.22, 0.41, 0.74],
    mid: [0.45, 0.64, 0.92],
    hot: [0.86, 0.92, 1],
    particle: [0.55, 0.7, 0.93]
  },
  'office-executive': {
    kind: 'embers',
    wash: [0.08, 0.06, 0.07, 0.58],
    deep: [0.52, 0.26, 0.3],
    mid: [0.77, 0.63, 0.46],
    hot: [0.98, 0.88, 0.7],
    particle: [0.83, 0.68, 0.48]
  },
  'noir-scholar': {
    kind: 'embers',
    wash: [0.09, 0.08, 0.06, 0.56],
    deep: [0.54, 0.38, 0.18],
    mid: [0.77, 0.64, 0.44],
    hot: [0.97, 0.9, 0.72],
    particle: [0.85, 0.72, 0.48]
  },
  'moonlit-maid': {
    kind: 'motes',
    wash: [0.28, 0.22, 0.32, 0.4],
    deep: [0.5, 0.38, 0.52],
    mid: [0.7, 0.56, 0.74],
    hot: [0.95, 0.9, 0.98],
    particle: [0.78, 0.68, 0.84]
  }
}

const DEFAULT_PALETTE: ThinkingEffectPalette = {
  kind: 'motes',
  wash: [0.07, 0.09, 0.14, 0.5],
  deep: [0.2, 0.42, 0.86],
  mid: [0.4, 0.62, 0.98],
  hot: [0.86, 0.92, 1],
  particle: [0.85, 0.9, 1]
}

export function thinkingEffectPalette(skin = currentVisualSkin()): ThinkingEffectPalette {
  return PALETTES[skin] ?? accentPalette()
}

export function currentVisualSkin(): string {
  return document.documentElement.dataset.visualSkin ?? ''
}

function accentPalette(): ThinkingEffectPalette {
  const accent = parseCssColor(
    getComputedStyle(document.documentElement).getPropertyValue('--accent')
  )
  if (!accent) return DEFAULT_PALETTE
  return {
    kind: 'motes',
    wash: [accent[0] * 0.12, accent[1] * 0.12, accent[2] * 0.16, 0.5],
    deep: accent,
    mid: mix(accent, [1, 1, 1], 0.35),
    hot: mix(accent, [1, 1, 1], 0.72),
    particle: mix(accent, [1, 1, 1], 0.45)
  }
}

function parseCssColor(value: string): [number, number, number] | null {
  const hex = value.trim().match(/^#([0-9a-f]{6})$/i)
  if (!hex) return null
  const n = Number.parseInt(hex[1], 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

function mix(
  a: [number, number, number],
  b: [number, number, number],
  t: number
): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

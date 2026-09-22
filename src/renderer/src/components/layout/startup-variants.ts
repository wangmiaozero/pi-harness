import type { MascotStyle } from '@shared/constants/mascot'
import { MASCOT_ENABLED } from '@shared/feature-flags'

export type StartupVariant = MascotStyle

export interface StartupPalette {
  background: string
  text: string
  accent: string
  secondary: string
  tertiary: string
  particles: readonly [string, string, string, string]
}

export const STARTUP_PALETTES: Record<StartupVariant, StartupPalette> = {
  none: {
    background: '#000000',
    text: '#f5f6fb',
    accent: '#6dcbf4',
    secondary: '#6dcbf4',
    tertiary: '#6dcbf4',
    particles: ['#6dcbf4', '#6dcbf4', '#6dcbf4', '#6dcbf4']
  },
  maidWhite: {
    background: '#172a32',
    text: '#fff9ec',
    accent: '#c5f6f0',
    secondary: '#8bdedb',
    tertiary: '#f9d9df',
    particles: ['#fffaf0', '#c5f6f0', '#8bdedb', '#f9d9df']
  },
  office: {
    background: '#101b26',
    text: '#f6f2e9',
    accent: '#e7bf78',
    secondary: '#88c5d5',
    tertiary: '#f6e4bd',
    particles: ['#f6f2e9', '#e7bf78', '#88c5d5', '#f6e4bd']
  },
  starshipCockpit: {
    background: '#030b1d',
    text: '#e8f8ff',
    accent: '#69dcff',
    secondary: '#487eff',
    tertiary: '#ffae68',
    particles: ['#e8f8ff', '#69dcff', '#487eff', '#ffae68']
  },
  noirScholar: {
    background: '#16151a',
    text: '#f1e8db',
    accent: '#d5b58a',
    secondary: '#b1a6a0',
    tertiary: '#8b4b52',
    particles: ['#f1e8db', '#d5b58a', '#b1a6a0', '#8b4b52']
  },
  moonlitMaid: {
    background: '#11152b',
    text: '#f5efff',
    accent: '#d5c5ff',
    secondary: '#9db8f7',
    tertiary: '#f6d1df',
    particles: ['#f5efff', '#d5c5ff', '#9db8f7', '#f6d1df']
  },
  mingSnow: {
    background: '#0c1d26',
    text: '#f7f1e4',
    accent: '#e4d2a8',
    secondary: '#b5dce8',
    tertiary: '#ae5c4d',
    particles: ['#f7f1e4', '#e4d2a8', '#b5dce8', '#ae5c4d']
  },
  mingMoon: {
    background: '#210e18',
    text: '#f7ead4',
    accent: '#efba72',
    secondary: '#d46b5b',
    tertiary: '#f9e2aa',
    particles: ['#f7ead4', '#efba72', '#d46b5b', '#f9e2aa']
  }
}

export function resolveStartupVariant(
  settings: { mascotStyle: MascotStyle; mascotUnlocked: boolean } | null | undefined,
  mascotEnabled = MASCOT_ENABLED
): StartupVariant {
  if (!mascotEnabled || !settings?.mascotUnlocked) return 'none'
  return Object.hasOwn(STARTUP_PALETTES, settings.mascotStyle) ? settings.mascotStyle : 'none'
}

export function particleOrigin(
  variant: StartupVariant,
  index: number,
  count: number,
  width: number,
  height: number,
  random: number,
  random2: number
): [number, number] {
  const t = index / Math.max(1, count)
  const angle = t * Math.PI * 8 + random * 0.7
  switch (variant) {
    case 'maidWhite':
      return [width * (t < 0.5 ? -0.12 : 1.12), height * (0.3 + 0.4 * Math.sin(t * Math.PI * 3))]
    case 'office':
      return [width * t, -height * (0.2 + random * 0.55)]
    case 'starshipCockpit':
      return [
        width / 2 + Math.cos(angle) * width * 0.02,
        height * 0.46 + Math.sin(angle) * height * 0.02
      ]
    case 'noirScholar':
      return [-width * (0.15 + random * 0.35), height * (1.1 - t * 1.5)]
    case 'moonlitMaid':
      return [
        width * 0.5 + Math.cos(angle) * width * 0.36,
        height * 0.28 + Math.sin(angle) * height * 0.32
      ]
    case 'mingSnow':
      return [width * t, -height * (0.15 + random * 0.7)]
    case 'mingMoon':
      return [
        width * 0.5 + Math.cos(angle) * width * 0.45,
        height * 0.46 + Math.sin(angle) * height * 0.45
      ]
    case 'none':
    default: {
      const radius = Math.max(width, height) * (0.25 + random2 * 0.6)
      return [
        width / 2 + Math.cos(random * Math.PI * 2) * radius,
        height * 0.46 + Math.sin(random * Math.PI * 2) * radius
      ]
    }
  }
}

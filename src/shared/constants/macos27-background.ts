export const MACOS27_BACKGROUNDS = [
  'liquid-ether',
  'lightfall',
  'lightning',
  'web-threads',
  'local-image'
] as const

export type MacOS27Background = (typeof MACOS27_BACKGROUNDS)[number]
export type MacOS27EffectBackground = Exclude<MacOS27Background, 'local-image'>

export const DEFAULT_MACOS27_BACKGROUND: MacOS27Background = 'liquid-ether'
export const MACOS27_BACKGROUND_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp'
] as const
export const MAX_MACOS27_BACKGROUND_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_MACOS27_BACKGROUND_IMAGE_DATA_URL_LENGTH = 14 * 1024 * 1024

export function normalizeMacOS27Background(value: unknown): MacOS27Background {
  return MACOS27_BACKGROUNDS.includes(value as MacOS27Background)
    ? (value as MacOS27Background)
    : DEFAULT_MACOS27_BACKGROUND
}

export function isMacOS27EffectBackground(
  value: MacOS27Background
): value is MacOS27EffectBackground {
  return value !== 'local-image'
}

export function isMacOS27BackgroundImageDataUrl(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_MACOS27_BACKGROUND_IMAGE_DATA_URL_LENGTH &&
    /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
  )
}

export function normalizeMacOS27BackgroundImage(value: unknown): string | null {
  return isMacOS27BackgroundImageDataUrl(value) ? value : null
}

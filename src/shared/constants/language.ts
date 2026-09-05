/**
 * Application UI languages.
 *
 * `auto` follows the OS locale at runtime; every other entry is a fixed
 * locale. The list order is also the order shown in Settings → Language.
 */
export const APP_LANGUAGES = [
  'auto',
  'en-US',
  'zh-CN',
  'zh-TW',
  'ja-JP',
  'ko-KR',
  'ru-RU',
  'fr-FR',
  'de-DE'
] as const

export type AppLanguage = (typeof APP_LANGUAGES)[number]

/** A concrete locale (never `auto`). */
export type AppLocale = Exclude<AppLanguage, 'auto'>

/** Native-script labels for Settings → Language (not translated). */
export const APP_LANGUAGE_LABELS: Record<AppLocale, string> = {
  'en-US': 'English',
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  'ja-JP': '日本語',
  'ko-KR': '한국어',
  'ru-RU': 'Русский',
  'fr-FR': 'Français',
  'de-DE': 'Deutsch'
}

/** Resolve the settings language against a BCP 47 system locale tag. */
export function resolveAppLocale(language: AppLanguage, systemLocale: string): AppLocale {
  if (language !== 'auto') return language
  const tag = systemLocale.toLowerCase()
  if (tag.startsWith('zh')) {
    return /-(tw|hk|mo|hant|hant-)/.test(tag) ? 'zh-TW' : 'zh-CN'
  }
  if (tag.startsWith('ja')) return 'ja-JP'
  if (tag.startsWith('ko')) return 'ko-KR'
  if (tag.startsWith('ru')) return 'ru-RU'
  if (tag.startsWith('fr')) return 'fr-FR'
  if (tag.startsWith('de')) return 'de-DE'
  if (tag.startsWith('en')) return 'en-US'
  return 'en-US'
}

/** True for every Chinese locale (Simplified or Traditional). */
export function isChineseLocale(locale: string): boolean {
  return locale.toLowerCase().startsWith('zh')
}

/** Native Electron menus only ship Simplified Chinese and English. */
export function toNativeMenuLocale(locale: string): 'zh-CN' | 'en-US' {
  return isChineseLocale(locale) ? 'zh-CN' : 'en-US'
}

import { createI18n } from 'vue-i18n'
import { resolveAppLocale, type AppLanguage } from '@shared/constants/language'
import { enUS } from './locales/en-US'
import { zhCN } from './locales/zh-CN'
import { zhTW } from './locales/zh-TW'
import { jaJP } from './locales/ja-JP'
import { koKR } from './locales/ko-KR'
import { ruRU } from './locales/ru-RU'
import { frFR } from './locales/fr-FR'
import { deDE } from './locales/de-DE'

export const messages = {
  'en-US': enUS,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  'ja-JP': jaJP,
  'ko-KR': koKR,
  'ru-RU': ruRU,
  'fr-FR': frFR,
  'de-DE': deDE
} as const

export type AppLocale = keyof typeof messages

export const i18n = createI18n({
  legacy: false,
  locale: resolveLocale('auto'),
  fallbackLocale: 'en-US',
  messages
})

/** Resolve settings language → active locale. The default (`auto`) follows the system. */
export function resolveLocale(language: AppLanguage, systemLocale?: string): AppLocale {
  const nav = systemLocale ?? (typeof navigator !== 'undefined' ? navigator.language : 'en-US')
  return resolveAppLocale(language, nav) as AppLocale
}

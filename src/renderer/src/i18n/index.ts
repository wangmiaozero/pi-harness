import { createI18n } from 'vue-i18n'
import type { AppLocale as SharedLocale, AppSettings } from '@shared/ipc/api-types'
import type { MessageTree } from './locales/en-US'
import { enUS } from './locales/en-US'
import { zhCN } from './locales/zh-CN'
import { koKR } from './locales/ko-KR'
import { ruRU } from './locales/ru-RU'
import { frFR } from './locales/fr-FR'
import { deDE } from './locales/de-DE'

export const messages = {
  'zh-CN': zhCN,
  'en-US': enUS,
  'ko-KR': koKR,
  'ru-RU': ruRU,
  'fr-FR': frFR,
  'de-DE': deDE
} as const satisfies Record<SharedLocale, MessageTree>

export type AppLocale = keyof typeof messages

export const APP_LOCALE_LABELS: Record<AppLocale, string> = {
  'zh-CN': '简体中文',
  'en-US': 'English',
  'ko-KR': '한국어',
  'ru-RU': 'Русский',
  'fr-FR': 'Français',
  'de-DE': 'Deutsch'
}

export const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'zh-CN',
  messages
})

const AUTO_PREFIX: Array<[string, AppLocale]> = [
  ['zh', 'zh-CN'],
  ['en', 'en-US'],
  ['ko', 'ko-KR'],
  ['ru', 'ru-RU'],
  ['fr', 'fr-FR'],
  ['de', 'de-DE']
]

/** Resolve settings language → active locale. Product default is zh-CN. */
export function resolveLocale(language: AppSettings['language']): AppLocale {
  if (language !== 'auto' && language in messages) return language as AppLocale
  const nav = (typeof navigator !== 'undefined' ? navigator.language : 'zh-CN').toLowerCase()
  const hit = AUTO_PREFIX.find(([prefix]) => nav === prefix || nav.startsWith(`${prefix}-`))
  return hit?.[1] ?? 'zh-CN'
}

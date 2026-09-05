import { describe, expect, it } from 'vitest'
import {
  APP_LANGUAGE_LABELS,
  APP_LANGUAGES,
  resolveAppLocale,
  toNativeMenuLocale,
  type AppLocale
} from './language'

describe('app language', () => {
  it('lists follow-system first, then the shipped locales', () => {
    expect(APP_LANGUAGES).toEqual([
      'auto',
      'en-US',
      'zh-CN',
      'zh-TW',
      'ja-JP',
      'ko-KR',
      'ru-RU',
      'fr-FR',
      'de-DE'
    ])
  })

  it('keeps a native-script label for every fixed locale', () => {
    const locales = APP_LANGUAGES.filter((language): language is AppLocale => language !== 'auto')
    expect(locales.every((locale) => APP_LANGUAGE_LABELS[locale].trim().length > 0)).toBe(true)
  })

  it('returns an explicit language unchanged', () => {
    expect(resolveAppLocale('ja-JP', 'en-US')).toBe('ja-JP')
    expect(resolveAppLocale('de-DE', 'zh-CN')).toBe('de-DE')
  })

  it.each([
    ['en-US', 'en-US'],
    ['en-GB', 'en-US'],
    ['zh-CN', 'zh-CN'],
    ['zh-Hans', 'zh-CN'],
    ['zh', 'zh-CN'],
    ['zh-TW', 'zh-TW'],
    ['zh-HK', 'zh-TW'],
    ['zh-MO', 'zh-TW'],
    ['zh-Hant', 'zh-TW'],
    ['zh-Hant-TW', 'zh-TW'],
    ['ja', 'ja-JP'],
    ['ja-JP', 'ja-JP'],
    ['ko', 'ko-KR'],
    ['ko-KR', 'ko-KR'],
    ['ru', 'ru-RU'],
    ['ru-RU', 'ru-RU'],
    ['fr', 'fr-FR'],
    ['fr-FR', 'fr-FR'],
    ['de', 'de-DE'],
    ['de-DE', 'de-DE'],
    ['es-ES', 'en-US'],
    ['pt-BR', 'en-US']
  ] as const)('maps auto + %s to %s', (systemLocale, expected) => {
    expect(resolveAppLocale('auto', systemLocale)).toBe(expected)
  })

  it('maps native menus to Chinese or English', () => {
    expect(toNativeMenuLocale('zh-CN')).toBe('zh-CN')
    expect(toNativeMenuLocale('zh-TW')).toBe('zh-CN')
    expect(toNativeMenuLocale('ja-JP')).toBe('en-US')
    expect(toNativeMenuLocale('en-US')).toBe('en-US')
  })
})

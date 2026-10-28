import { afterEach, describe, expect, it, vi } from 'vitest'
import { APP_LANGUAGES, resolveAppLocale } from '@shared/constants/language'
import { menuLabels } from './menu'
import { BUBBLE_MESSAGES, bubbleMessages } from './bubbles'

afterEach(() => vi.restoreAllMocks())

describe('desktop pet application locale', () => {
  it('supports every language in the application settings', () => {
    for (const language of APP_LANGUAGES) {
      expect(menuLabels(language).openMain).toBeTruthy()
      expect(bubbleMessages(language)).toEqual(
        BUBBLE_MESSAGES[resolveAppLocale(language, navigator.language)]
      )
    }
  })

  it.each(['zh-CN', 'zh-Hant-TW', 'ja-JP', 'ko-KR', 'ru-RU', 'fr-FR', 'de-DE', 'en-US'])(
    'auto follows the same system locale as the main UI: %s',
    (systemLocale) => {
      vi.spyOn(navigator, 'language', 'get').mockReturnValue(systemLocale)
      const locale = resolveAppLocale('auto', systemLocale)
      expect(menuLabels('auto')).toEqual(menuLabels(locale))
      expect(bubbleMessages('auto')).toEqual(bubbleMessages(locale))
    }
  )
})

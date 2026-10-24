import { mcpMarketEn, mcpMarketZh } from './mcp-market'
import { liveVoiceEn, liveVoiceZh } from './live-voice'
import { agentSettingsEn, agentSettingsZh } from './agent-settings'
import { runtimeEn, runtimeZh } from './runtime'
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
import { intelligenceEn, intelligenceZh } from './intelligence'
import {
  intelligenceTw,
  intelligenceJa,
  intelligenceKo,
  intelligenceRu,
  intelligenceFr,
  intelligenceDe
} from './intelligence-locales'

export const messages = {
  'en-US': {
    ...enUS,
    agentSettings: agentSettingsEn,
    liveVoice: liveVoiceEn,
    mcpMarket: mcpMarketEn,
    runtime: runtimeEn,
    intelligence: intelligenceEn
  },
  'zh-CN': {
    ...zhCN,
    agentSettings: agentSettingsZh,
    liveVoice: liveVoiceZh,
    mcpMarket: mcpMarketZh,
    runtime: runtimeZh,
    intelligence: intelligenceZh
  },
  'zh-TW': {
    ...zhTW,
    agentSettings: agentSettingsEn,
    liveVoice: liveVoiceEn,
    mcpMarket: mcpMarketEn,
    runtime: runtimeEn,
    intelligence: intelligenceTw
  },
  'ja-JP': {
    ...jaJP,
    agentSettings: agentSettingsEn,
    liveVoice: liveVoiceEn,
    mcpMarket: mcpMarketEn,
    runtime: runtimeEn,
    intelligence: intelligenceJa
  },
  'ko-KR': {
    ...koKR,
    agentSettings: agentSettingsEn,
    liveVoice: liveVoiceEn,
    mcpMarket: mcpMarketEn,
    runtime: runtimeEn,
    intelligence: intelligenceKo
  },
  'ru-RU': {
    ...ruRU,
    agentSettings: agentSettingsEn,
    liveVoice: liveVoiceEn,
    mcpMarket: mcpMarketEn,
    runtime: runtimeEn,
    intelligence: intelligenceRu
  },
  'fr-FR': {
    ...frFR,
    agentSettings: agentSettingsEn,
    liveVoice: liveVoiceEn,
    mcpMarket: mcpMarketEn,
    runtime: runtimeEn,
    intelligence: intelligenceFr
  },
  'de-DE': {
    ...deDE,
    agentSettings: agentSettingsEn,
    liveVoice: liveVoiceEn,
    mcpMarket: mcpMarketEn,
    runtime: runtimeEn,
    intelligence: intelligenceDe
  }
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

import { chatActivity } from './chat-activity'
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
    workspace: { ...enUS.workspace, activity: chatActivity['en-US'] },
    agentSettings: agentSettingsEn,
    liveVoice: liveVoiceEn,
    mcpMarket: mcpMarketEn,
    runtime: runtimeEn,
    intelligence: intelligenceEn
  },
  'zh-CN': {
    ...zhCN,
    workspace: { ...zhCN.workspace, activity: chatActivity['zh-CN'] },
    agentSettings: agentSettingsZh,
    liveVoice: liveVoiceZh,
    mcpMarket: mcpMarketZh,
    runtime: runtimeZh,
    intelligence: intelligenceZh
  },
  'zh-TW': {
    ...zhTW,
    workspace: { ...zhTW.workspace, activity: chatActivity['zh-TW'] },
    agentSettings: agentSettingsEn,
    liveVoice: liveVoiceEn,
    mcpMarket: mcpMarketEn,
    runtime: runtimeEn,
    intelligence: intelligenceTw
  },
  'ja-JP': {
    ...jaJP,
    workspace: { ...jaJP.workspace, activity: chatActivity['ja-JP'] },
    agentSettings: agentSettingsEn,
    liveVoice: liveVoiceEn,
    mcpMarket: mcpMarketEn,
    runtime: runtimeEn,
    intelligence: intelligenceJa
  },
  'ko-KR': {
    ...koKR,
    workspace: { ...koKR.workspace, activity: chatActivity['ko-KR'] },
    agentSettings: agentSettingsEn,
    liveVoice: liveVoiceEn,
    mcpMarket: mcpMarketEn,
    runtime: runtimeEn,
    intelligence: intelligenceKo
  },
  'ru-RU': {
    ...ruRU,
    workspace: { ...ruRU.workspace, activity: chatActivity['ru-RU'] },
    agentSettings: agentSettingsEn,
    liveVoice: liveVoiceEn,
    mcpMarket: mcpMarketEn,
    runtime: runtimeEn,
    intelligence: intelligenceRu
  },
  'fr-FR': {
    ...frFR,
    workspace: { ...frFR.workspace, activity: chatActivity['fr-FR'] },
    agentSettings: agentSettingsEn,
    liveVoice: liveVoiceEn,
    mcpMarket: mcpMarketEn,
    runtime: runtimeEn,
    intelligence: intelligenceFr
  },
  'de-DE': {
    ...deDE,
    workspace: { ...deDE.workspace, activity: chatActivity['de-DE'] },
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

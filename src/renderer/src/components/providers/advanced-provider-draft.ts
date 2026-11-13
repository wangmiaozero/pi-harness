import {
  providerAdvancedSchema,
  type ProviderAdvancedSettings
} from '@shared/providers/advanced-settings'
import type { AdvancedDraft } from './ProviderAdvancedFields.vue'

const showLimits = (limits?: Record<string, number>) =>
  Object.entries(limits ?? {})
    .map(([id, value]) => (id === '*' ? String(value) : `${id}=${value}`))
    .join(', ')

export function advancedProviderDraft(value?: ProviderAdvancedSettings): AdvancedDraft {
  return {
    extraBody: value?.extraBody ? JSON.stringify(value.extraBody, null, 2) : '',
    requestHeaders: value?.requestHeaders?.join(', ') ?? '',
    responseHeaders: value?.responseHeaders?.join(', ') ?? '',
    proxyMode: value?.proxy?.mode ?? '',
    proxyUrl: value?.proxy?.mode === 'custom' ? value.proxy.url : '',
    concurrency: String(value?.concurrency ?? ''),
    requestsPerMinute: String(value?.requestsPerMinute ?? ''),
    queueLimit: String(value?.queueLimit ?? ''),
    queueWaitSeconds: String(value?.queueWaitSeconds ?? ''),
    priceMultiplier: String(value?.priceMultiplier ?? ''),
    free: value?.free ?? false,
    billing: value?.billing ?? '',
    authMode: value?.authMode ?? '',
    sendUserAgent: value?.sendUserAgent ?? true,
    redactSecrets: value?.redactSecrets ?? false,
    responsesWebSocket: value?.responsesWebSocket ?? false,
    nativeCompaction: value?.nativeCompaction ?? false,
    contextWindows: showLimits(value?.contextWindows),
    outputLimits: showLimits(value?.outputLimits),
    compactionThresholds: showLimits(value?.compactionThresholds),
    rateWindows:
      value?.rateWindows?.map((window) => ({
        ...window,
        days: window.days ? [...window.days] : undefined
      })) ?? []
  }
}

function parseLimits(text: string) {
  if (!text.trim()) return
  return Object.fromEntries(
    text.split(/[,，]/).map((part) => {
      const entry = part.trim()
      const separator = entry.lastIndexOf('=')
      const key = separator < 0 ? '*' : entry.slice(0, separator).trim()
      const raw = entry.slice(separator + 1).trim()
      const match = /^(\d+(?:\.\d+)?)([km])?$/i.exec(raw)
      const unit = match?.[2]?.toLowerCase()
      const count = match
        ? Number(match[1]) * (unit === 'm' ? 1_000_000 : unit === 'k' ? 1000 : 1)
        : NaN
      return [key, count]
    })
  )
}

export function parseAdvancedProviderDraft(draft: AdvancedDraft): ProviderAdvancedSettings {
  const number = (value: string) => (String(value).trim() ? Number(value) : undefined)
  const headers = (value: string) =>
    value
      .split(/[,，]/)
      .map((name) => name.trim())
      .filter(Boolean)
  return providerAdvancedSchema.parse({
    extraBody: draft.extraBody.trim() ? JSON.parse(draft.extraBody) : undefined,
    requestHeaders: headers(draft.requestHeaders),
    responseHeaders: headers(draft.responseHeaders),
    proxy: draft.proxyMode ? { mode: draft.proxyMode, url: draft.proxyUrl.trim() } : undefined,
    concurrency: number(draft.concurrency) === 0 ? undefined : number(draft.concurrency),
    requestsPerMinute:
      number(draft.requestsPerMinute) === 0 ? undefined : number(draft.requestsPerMinute),
    queueLimit: number(draft.queueLimit),
    queueWaitSeconds:
      number(draft.queueWaitSeconds) === 0 ? undefined : number(draft.queueWaitSeconds),
    priceMultiplier: number(draft.priceMultiplier),
    free: draft.free || undefined,
    billing: draft.billing || undefined,
    authMode: draft.authMode || undefined,
    sendUserAgent: draft.sendUserAgent ? undefined : false,
    redactSecrets: draft.redactSecrets || undefined,
    responsesWebSocket: draft.responsesWebSocket || undefined,
    nativeCompaction: draft.nativeCompaction || undefined,
    contextWindows: parseLimits(draft.contextWindows),
    outputLimits: parseLimits(draft.outputLimits),
    compactionThresholds: parseLimits(draft.compactionThresholds),
    rateWindows: draft.rateWindows.map((window) => ({
      ...window,
      days: window.days ? [...window.days] : undefined
    }))
  })
}

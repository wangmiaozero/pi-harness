import { z } from 'zod'

const reservedBodyFields = new Set([
  'model',
  'stream',
  'messages',
  'input',
  'contents',
  'system',
  'systemInstruction',
  'system_instruction',
  'instructions',
  'tools',
  'tool_choice',
  'store',
  '__proto__',
  'constructor',
  'prototype'
])
const forbiddenHeader =
  /^(?:authorization|authentication-info|api-key|x-api-key|x-goog-api-key|cookie|set-cookie2?|host|connection|transfer-encoding|upgrade|te|trailer|origin|location|www-authenticate|(?:content|proxy|sec|access-control)-.*)$/i
const header = z
  .string()
  .max(128)
  .regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/)
  .refine((name) => !forbiddenHeader.test(name), 'This header cannot be forwarded')
const tokenLimit = z.number().int().min(1).max(100_000_000)
const modelLimits = z.record(z.string().min(1).max(256), tokenLimit).optional()
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
const multiplier = z.number().min(0).max(1000)
const proxyUrl = z
  .string()
  .max(512)
  .refine((value) => {
    const url = URL.parse(value)
    return (
      !!url &&
      ['http:', 'https:', 'socks4:', 'socks5:'].includes(url.protocol) &&
      !!url.hostname &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.pathname === '/' || url.pathname === '')
    )
  }, 'Enter an HTTP, HTTPS, SOCKS4 or SOCKS5 proxy URL without credentials')

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
const json: z.ZodType<JsonValue> = z.json()

export const providerAdvancedSchema = z.object({
  extraBody: z
    .record(z.string().min(1).max(128), json)
    .refine(
      (fields) =>
        Object.keys(fields).length <= 64 &&
        JSON.stringify(fields).length <= 32768 &&
        Object.keys(fields).every((key) => !reservedBodyFields.has(key) && key === key.trim()),
      'Extra request body contains a reserved field or is too large'
    )
    .optional(),
  requestHeaders: z.array(header).max(32).optional(),
  responseHeaders: z.array(header).max(32).optional(),
  proxy: z
    .discriminatedUnion('mode', [
      z.object({ mode: z.literal('system') }),
      z.object({ mode: z.literal('direct') }),
      z.object({ mode: z.literal('custom'), url: proxyUrl })
    ])
    .optional(),
  concurrency: z.number().int().min(1).max(1000).optional(),
  requestsPerMinute: z.number().int().min(1).max(10000).optional(),
  queueLimit: z.number().int().min(0).max(10000).optional(),
  queueWaitSeconds: z.number().int().min(1).max(3600).optional(),
  priceMultiplier: multiplier.optional(),
  free: z.boolean().optional(),
  billing: z.enum(['subscription', 'metered']).optional(),
  rateWindows: z
    .array(
      z.object({
        start: time,
        end: time,
        multiplier,
        days: z.array(z.number().int().min(0).max(6)).max(7).optional()
      })
    )
    .max(32)
    .optional(),
  authMode: z.enum(['both', 'api-key', 'bearer']).optional(),
  sendUserAgent: z.boolean().optional(),
  redactSecrets: z.boolean().optional(),
  responsesWebSocket: z.boolean().optional(),
  nativeCompaction: z.boolean().optional(),
  contextWindows: modelLimits,
  outputLimits: modelLimits,
  compactionThresholds: modelLimits
})

export type ProviderAdvancedSettings = z.infer<typeof providerAdvancedSchema>

export const chatGptGatewaySettingsSchema = z.strictObject({
  maxAccounts: z.number().int().min(1).max(20).optional(),
  proxy: providerAdvancedSchema.shape.proxy,
  concurrency: providerAdvancedSchema.shape.concurrency,
  requestsPerMinute: providerAdvancedSchema.shape.requestsPerMinute,
  queueLimit: providerAdvancedSchema.shape.queueLimit,
  queueWaitSeconds: providerAdvancedSchema.shape.queueWaitSeconds,
  priceMultiplier: providerAdvancedSchema.shape.priceMultiplier,
  free: providerAdvancedSchema.shape.free,
  billing: providerAdvancedSchema.shape.billing,
  rateWindows: providerAdvancedSchema.shape.rateWindows,
  redactSecrets: providerAdvancedSchema.shape.redactSecrets,
  resetScope: z.enum(['off', 'week', 'both']).optional(),
  contextWindows: providerAdvancedSchema.shape.contextWindows,
  compactionThresholds: providerAdvancedSchema.shape.compactionThresholds
})
export type ChatGptGatewaySettings = z.infer<typeof chatGptGatewaySettingsSchema>

export function providerCostMultiplier(settings: ProviderAdvancedSettings, at: number): number {
  if (settings.free || settings.billing === 'subscription') return 0
  const date = new Date(at)
  const minutes = date.getHours() * 60 + date.getMinutes()
  const day = date.getDay()
  const rate = settings.rateWindows?.find((window) => {
    const toMinutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3))
    const start = toMinutes(window.start)
    const end = toMinutes(window.end)
    const overnight = end <= start
    const startDay = overnight && minutes < end ? (day + 6) % 7 : day
    return (
      (!window.days?.length || window.days.includes(startDay)) &&
      (overnight ? minutes >= start || minutes < end : minutes >= start && minutes < end)
    )
  })
  return (settings.priceMultiplier ?? 1) * (rate?.multiplier ?? 1)
}

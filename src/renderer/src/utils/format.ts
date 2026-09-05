import { formatDistanceToNow, format } from 'date-fns'
import { de, enUS, fr, ja, ko, ru, zhCN, zhTW } from 'date-fns/locale'

const localeMap = {
  'en-US': enUS,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  'ja-JP': ja,
  'ko-KR': ko,
  'ru-RU': ru,
  'fr-FR': fr,
  'de-DE': de
} as const

export type FormatLocale = keyof typeof localeMap

function resolveFormatLocale(locale: string): FormatLocale {
  return locale in localeMap ? (locale as FormatLocale) : 'en-US'
}

export function formatRelativeTime(
  timestamp: number | Date | null | undefined,
  locale: string = 'en-US'
): string {
  if (timestamp == null) return '—'
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp)
  if (Number.isNaN(date.getTime())) return '—'
  return formatDistanceToNow(date, {
    addSuffix: true,
    locale: localeMap[resolveFormatLocale(locale)]
  })
}

export function formatDateTime(
  timestamp: number | Date | null | undefined,
  locale: string = 'en-US'
): string {
  if (timestamp == null) return '—'
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp)
  if (Number.isNaN(date.getTime())) return '—'
  return format(date, 'yyyy-MM-dd HH:mm:ss', { locale: localeMap[resolveFormatLocale(locale)] })
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** i
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

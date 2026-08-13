import { formatDistanceToNow, format, type Locale } from 'date-fns'
import { de, enUS, fr, ko, ru, zhCN } from 'date-fns/locale'

const localeMap: Record<string, Locale> = {
  'en-US': enUS,
  'zh-CN': zhCN,
  'ko-KR': ko,
  'ru-RU': ru,
  'fr-FR': fr,
  'de-DE': de
}

function dateLocale(locale: string): Locale {
  return localeMap[locale] ?? zhCN
}

export function formatRelativeTime(
  timestamp: number | Date | null | undefined,
  locale = 'zh-CN'
): string {
  if (timestamp == null) return '—'
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp)
  if (Number.isNaN(date.getTime())) return '—'
  return formatDistanceToNow(date, { addSuffix: true, locale: dateLocale(locale) })
}

export function formatDateTime(
  timestamp: number | Date | null | undefined,
  locale = 'zh-CN'
): string {
  if (timestamp == null) return '—'
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp)
  if (Number.isNaN(date.getTime())) return '—'
  return format(date, 'yyyy-MM-dd HH:mm:ss', { locale: dateLocale(locale) })
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** i
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

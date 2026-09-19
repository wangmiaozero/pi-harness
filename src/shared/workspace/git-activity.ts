import type { GitActivityAuthor, GitActivityDay } from '../types/workspace'

export const GIT_ACTIVITY_DAYS = 182

export function parseGitActivityLog(
  output: string,
  windowDays = GIT_ACTIVITY_DAYS,
  now = new Date()
): GitActivityDay[] {
  const counts = new Map<string, number>()
  const authorsByDate = new Map<string, Map<string, GitActivityAuthor>>()

  for (const line of output.split(/\r?\n/)) {
    const raw = line.trim()
    if (!raw) continue
    const [date = '', name = '', email = ''] = raw.split('\x1f')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    counts.set(date, (counts.get(date) ?? 0) + 1)
    const key = email || name
    if (!key) continue
    let authors = authorsByDate.get(date)
    if (!authors) {
      authors = new Map()
      authorsByDate.set(date, authors)
    }
    const current = authors.get(key)
    if (current) current.commits += 1
    else authors.set(key, { name: name || email, email, commits: 1 })
  }

  const days: GitActivityDay[] = []
  if (!counts.size) return days

  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const first = new Date(today)
  first.setDate(first.getDate() - (windowDays - 1))
  for (let cursor = new Date(first); cursor <= today; cursor.setDate(cursor.getDate() + 1)) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(
      cursor.getDate()
    ).padStart(2, '0')}`
    const authors = [...(authorsByDate.get(key)?.values() ?? [])].sort(
      (left, right) => right.commits - left.commits || left.name.localeCompare(right.name)
    )
    days.push({ date: key, commits: counts.get(key) ?? 0, authors })
  }
  return days
}

export function summarizeAuthors(days: readonly GitActivityDay[]): GitActivityAuthor[] {
  const authors = new Map<string, GitActivityAuthor>()
  for (const day of days) {
    for (const author of day.authors ?? []) {
      const key = author.email || author.name
      if (!key) continue
      const current = authors.get(key)
      if (current) current.commits += author.commits
      else authors.set(key, { name: author.name, email: author.email, commits: author.commits })
    }
  }
  return [...authors.values()].sort(
    (left, right) => right.commits - left.commits || left.name.localeCompare(right.name)
  )
}

export function authorInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return Array.from(parts[0] ?? '').slice(0, 2).join('').toUpperCase()
  return `${parts[0]?.[0] ?? ''}${parts[parts.length - 1]?.[0] ?? ''}`.toUpperCase()
}

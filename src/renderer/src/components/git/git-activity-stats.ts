import type { GitActivityAuthor, GitActivityDay } from '@shared/types/workspace'
import { summarizeAuthors } from '@shared/workspace/git-activity'

export interface GitActivitySummary {
  total: number
  activeDays: number
  peakDate: string
  peakCommits: number
}

export interface GitActivityWeek {
  start: string
  commits: number
  authors: GitActivityAuthor[]
}

export function summarizeActivity(days: readonly GitActivityDay[]): GitActivitySummary {
  let total = 0
  let activeDays = 0
  let peakDate = ''
  let peakCommits = 0
  for (const day of days) {
    total += day.commits
    if (day.commits > 0) activeDays += 1
    if (day.commits > peakCommits) {
      peakCommits = day.commits
      peakDate = day.date
    }
  }
  return { total, activeDays, peakDate, peakCommits }
}

export function weeklyActivity(days: readonly GitActivityDay[]): GitActivityWeek[] {
  const weeks: GitActivityWeek[] = []
  for (let index = 0; index < days.length; index += 7) {
    const slice = days.slice(index, index + 7)
    const start = slice[0]?.date ?? ''
    if (!start) continue
    weeks.push({
      start,
      commits: slice.reduce((sum, day) => sum + day.commits, 0),
      authors: summarizeAuthors(slice)
    })
  }
  return weeks
}

const WEEKLY_TOOLTIP_AUTHORS = 8

export function weeklyTooltipLines(
  week: GitActivityWeek,
  labels: { weekly: string; authorCommits: (count: number) => string; more: (count: number) => string }
): string[] {
  const shown = week.authors.slice(0, WEEKLY_TOOLTIP_AUTHORS)
  const hidden = week.authors.length - shown.length
  const lines = [
    labels.weekly,
    labels.authorCommits(week.commits),
    ...shown.map((author) => `${author.name} · ${labels.authorCommits(author.commits)}`)
  ]
  if (hidden > 0) lines.push(labels.more(hidden))
  return lines
}

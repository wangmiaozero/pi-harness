import { describe, expect, it } from 'vitest'
import { summarizeActivity, weeklyActivity, weeklyTooltipLines } from './git-activity-stats'

describe('git activity stats', () => {
  it('summarizes totals, active days, and the peak day', () => {
    expect(
      summarizeActivity([
        { date: '2026-09-01', commits: 2 },
        { date: '2026-09-02', commits: 0 },
        { date: '2026-09-03', commits: 5 }
      ])
    ).toEqual({
      total: 7,
      activeDays: 2,
      peakDate: '2026-09-03',
      peakCommits: 5
    })
  })

  it('rolls days into seven-day weeks', () => {
    const days = Array.from({ length: 14 }, (_, index) => ({
      date: `2026-09-${String(index + 1).padStart(2, '0')}`,
      commits: index < 7 ? 1 : 2
    }))
    expect(weeklyActivity(days)).toEqual([
      { start: '2026-09-01', commits: 7, authors: [] },
      { start: '2026-09-08', commits: 14, authors: [] }
    ])
  })

  it('rolls authors into the weekly tooltip', () => {
    const weeks = weeklyActivity([
      {
        date: '2026-09-01',
        commits: 3,
        authors: [{ name: 'Ada', email: 'ada@example.com', commits: 3 }]
      },
      {
        date: '2026-09-02',
        commits: 2,
        authors: [{ name: 'Lin', email: 'lin@example.com', commits: 2 }]
      }
    ])
    expect(weeks[0]?.authors).toEqual([
      { name: 'Ada', email: 'ada@example.com', commits: 3 },
      { name: 'Lin', email: 'lin@example.com', commits: 2 }
    ])
    expect(
      weeklyTooltipLines(weeks[0]!, {
        weekly: 'Weekly commits',
        authorCommits: (count) => `${count} commits`,
        more: (count) => `+${count}`
      })
    ).toEqual([
      'Weekly commits',
      '5 commits',
      'Ada · 3 commits',
      'Lin · 2 commits'
    ])
  })
})

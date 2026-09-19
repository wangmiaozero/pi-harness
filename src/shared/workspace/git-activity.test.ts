import { describe, expect, it } from 'vitest'
import { authorInitials, parseGitActivityLog, summarizeAuthors } from './git-activity'

describe('git activity log', () => {
  it('counts commits and authors per day', () => {
    const days = parseGitActivityLog(
      [
        '2026-09-18\x1fAda\x1fada@example.com',
        '2026-09-18\x1fAda\x1fada@example.com',
        '2026-09-19\x1fLin\x1flin@example.com'
      ].join('\n'),
      3,
      new Date('2026-09-19T12:00:00')
    )

    expect(days).toEqual([
      { date: '2026-09-17', commits: 0, authors: [] },
      {
        date: '2026-09-18',
        commits: 2,
        authors: [{ name: 'Ada', email: 'ada@example.com', commits: 2 }]
      },
      {
        date: '2026-09-19',
        commits: 1,
        authors: [{ name: 'Lin', email: 'lin@example.com', commits: 1 }]
      }
    ])
    expect(summarizeAuthors(days)).toEqual([
      { name: 'Ada', email: 'ada@example.com', commits: 2 },
      { name: 'Lin', email: 'lin@example.com', commits: 1 }
    ])
  })

  it('builds compact initials for the author chip', () => {
    expect(authorInitials('wangmiao')).toBe('WA')
    expect(authorInitials('Ada Lovelace')).toBe('AL')
  })
})

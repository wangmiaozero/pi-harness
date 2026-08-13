import { describe, it, expect } from 'vitest'
import { formatRelativeTime, formatBytes } from '@renderer/utils/format'

describe('formatRelativeTime', () => {
  it('returns em dash for null', () => {
    expect(formatRelativeTime(null)).toBe('—')
  })

  it('formats recent timestamp', () => {
    const now = Date.now()
    const result = formatRelativeTime(now - 60_000)
    expect(result).toMatch(/ago|前/)
  })
})

describe('formatBytes', () => {
  it('formats kilobytes', () => {
    expect(formatBytes(2048)).toBe('2.0 KB')
  })
})

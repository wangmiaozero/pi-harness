import { describe, it, expect } from 'vitest'
import { diffLines, diffSummary } from '@shared/utils/diff'

describe('diffLines', () => {
  it('reports identical for equal texts', () => {
    const r = diffLines('a\nb\n', 'a\nb\n')
    expect(r.identical).toBe(true)
    expect(r.addedCount).toBe(0)
    expect(r.removedCount).toBe(0)
    expect(r.lines.every((l) => l.op === 'equal')).toBe(true)
  })

  it('detects added and removed lines', () => {
    const left = 'keep\nold\nkeep2'
    const right = 'keep\nnew\nkeep2'
    const r = diffLines(left, right)
    expect(r.identical).toBe(false)
    expect(r.removedCount).toBe(1)
    expect(r.addedCount).toBe(1)
    expect(r.lines.some((l) => l.op === 'removed' && l.text === 'old')).toBe(true)
    expect(r.lines.some((l) => l.op === 'added' && l.text === 'new')).toBe(true)
  })

  it('handles empty vs content', () => {
    const r = diffLines('', 'only\n')
    expect(r.addedCount).toBe(1)
    expect(r.removedCount).toBe(0)
  })

  it('summary formats counts', () => {
    const r = diffLines('a', 'b\nc')
    expect(diffSummary(r)).toMatch(/^\+\d+ −\d+$/)
  })
})

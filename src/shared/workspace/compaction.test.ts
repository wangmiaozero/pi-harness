import { describe, expect, it } from 'vitest'
import {
  canRequestCompaction,
  compactionUsageHint,
  compactionUsageRatio,
  inspectCompactionBusy,
  parseCompactionRuntimeResult
} from './compaction'

describe('canRequestCompaction', () => {
  it('only requires a session id', () => {
    expect(canRequestCompaction(null)).toBe(false)
    expect(canRequestCompaction(undefined)).toBe(false)
    expect(canRequestCompaction('session-1')).toBe(true)
  })
})

describe('compaction usage hints', () => {
  it('treats missing usage as unknown instead of zero tokens', () => {
    expect(compactionUsageRatio(null)).toBeNull()
    expect(compactionUsageRatio({ tokens: null, contextWindow: 128_000 })).toBeNull()
    expect(compactionUsageHint(null)).toBe('unknown')
  })

  it('maps usage ratio to recommendation copy only', () => {
    expect(compactionUsageHint(0.05)).toBe('low')
    expect(compactionUsageHint(0.45)).toBe('ready')
    expect(compactionUsageHint(0.7)).toBe('recommend')
    expect(compactionUsageHint(0.85)).toBe('urgent')
  })
})

describe('inspectCompactionBusy', () => {
  it('prefers compacting over other busy states', () => {
    expect(inspectCompactionBusy({ isCompacting: true, isStreaming: true })).toBe('compacting')
    expect(inspectCompactionBusy({ isStreaming: true })).toBe('working')
    expect(inspectCompactionBusy({ isPromptRunning: true })).toBe('working')
    expect(inspectCompactionBusy({ sending: true })).toBe('working')
    expect(inspectCompactionBusy({})).toBeNull()
  })
})

describe('parseCompactionRuntimeResult', () => {
  it('maps Pi skip reasons without treating them as failures', () => {
    expect(parseCompactionRuntimeResult({ cancelled: true, reason: 'session-too-small' })).toEqual({
      status: 'session-too-small'
    })
    expect(parseCompactionRuntimeResult({ cancelled: true, reason: 'already-compacted' })).toEqual({
      status: 'already-compacted'
    })
  })

  it('keeps optional compact metadata when Pi returns it', () => {
    expect(
      parseCompactionRuntimeResult({
        tokensBefore: 32421,
        firstKeptEntryId: 'entry-1'
      })
    ).toEqual({
      status: 'compacted',
      tokensBefore: 32421,
      firstKeptEntryId: 'entry-1'
    })
    expect(parseCompactionRuntimeResult(null)).toEqual({ status: 'compacted' })
  })
})

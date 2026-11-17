import { describe, expect, it } from 'vitest'
import {
  harnessCompactSchema,
  harnessQueueMessageSchema,
  harnessSessionInputSchema,
  harnessSetToolsSchema
} from './harness'

describe('Harness IPC schemas', () => {
  it('accepts bounded typed control requests', () => {
    expect(harnessSessionInputSchema.safeParse({ sessionId: 'session-1' }).success).toBe(true)
    expect(
      harnessSetToolsSchema.safeParse({ sessionId: 'session-1', toolNames: ['read'] }).success
    ).toBe(true)
    expect(
      harnessCompactSchema.safeParse({ sessionId: 'session-1', instructions: 'Keep decisions' })
        .success
    ).toBe(true)
  })

  it('validates custom tool writes while accepting the legacy request', () => {
    const body = { sessionId: 'session-1', toolNames: ['mcp__server__inspect'] }
    expect(harnessSetToolsSchema.safeParse({ ...body, custom: true }).success).toBe(true)
    expect(
      harnessSetToolsSchema.safeParse({ ...body, custom: true, toolNames: ['bad\0name'] }).success
    ).toBe(false)
    expect(
      harnessSetToolsSchema.safeParse({ ...body, custom: true, toolNames: ['two names'] }).success
    ).toBe(false)
    expect(harnessSetToolsSchema.safeParse({ ...body, custom: true, restore: true }).success).toBe(
      false
    )
  })

  it('rejects unknown fields and oversized or empty queue messages', () => {
    expect(
      harnessSessionInputSchema.safeParse({ sessionId: 'session-1', command: 'bash' }).success
    ).toBe(false)
    expect(
      harnessQueueMessageSchema.safeParse({ sessionId: 'session-1', message: '   ' }).success
    ).toBe(false)
    expect(
      harnessCompactSchema.safeParse({
        sessionId: 'session-1',
        instructions: 'x'.repeat(20_001)
      }).success
    ).toBe(false)
  })
})

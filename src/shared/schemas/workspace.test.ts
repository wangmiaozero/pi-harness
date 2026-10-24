import { describe, expect, it } from 'vitest'
import { startAgentSessionSchema } from './workspace'

describe('startAgentSessionSchema', () => {
  it('passes the selected permission mode through to the agent runtime', () => {
    // Regression: the IPC boundary silently stripped permissionMode, so every
    // session started without the selected mode and the workspace write guard
    // was relaxed for all callers.
    const parsed = startAgentSessionSchema.safeParse({
      cwd: '/tmp/workspace',
      permissionMode: 'ask'
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.permissionMode).toBe('ask')
  })

  it('leaves the permission mode undefined when the caller did not choose one', () => {
    const parsed = startAgentSessionSchema.safeParse({ cwd: '/tmp/workspace' })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.permissionMode).toBeUndefined()
  })
})

import { describe, expect, it } from 'vitest'
import { sessionCleanupExecuteSchema, sessionCleanupPreviewSchema, startAgentSessionSchema } from './workspace'

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

describe('sessionCleanupPreviewSchema', () => {
  it('requires a project key for the current-project scope', () => {
    const missing = sessionCleanupPreviewSchema.safeParse({ scope: 'current-project' })
    expect(missing.success).toBe(false)
    const present = sessionCleanupPreviewSchema.safeParse({
      scope: 'current-project',
      projectKey: 'p'
    })
    expect(present.success).toBe(true)
  })

  it('accepts known scopes and optional protection options', () => {
    const parsed = sessionCleanupPreviewSchema.safeParse({
      scope: 'older-30d',
      keepPinned: true,
      pinnedSessionIds: ['s1']
    })
    expect(parsed.success).toBe(true)
    const unknown = sessionCleanupPreviewSchema.safeParse({ scope: 'everything' })
    expect(unknown.success).toBe(false)
  })

  it('caps the pinned session list size', () => {
    const parsed = sessionCleanupPreviewSchema.safeParse({
      scope: 'all',
      pinnedSessionIds: Array.from({ length: 10_001 }, (_, i) => `s${i}`)
    })
    expect(parsed.success).toBe(false)
  })
})

describe('sessionCleanupExecuteSchema', () => {
  it('only accepts UUID-shaped preview tokens', () => {
    expect(
      sessionCleanupExecuteSchema.safeParse({
        previewToken: 'd3b07384-d9a0-4f9c-8a5e-6b1c2d4e5f60'
      }).success
    ).toBe(true)
    expect(sessionCleanupExecuteSchema.safeParse({ previewToken: '../etc/passwd' }).success).toBe(
      false
    )
    expect(sessionCleanupExecuteSchema.safeParse({ previewToken: '' }).success).toBe(false)
  })
})

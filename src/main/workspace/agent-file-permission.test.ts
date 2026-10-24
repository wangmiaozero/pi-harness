import { describe, expect, it, vi } from 'vitest'
import { PathDeniedError } from '../services/errors'
import { assertAgentFilePermission } from './agent-file-permission'

describe('agent file permissions', () => {
  const target = '/external/fixture.txt'
  it('allows full access without asking or creating workspace grants', async () => {
    const workspace = vi.fn()
    const approve = vi.fn()
    await expect(assertAgentFilePermission(target, 'auto', workspace, approve)).resolves.toBe(
      target
    )
    expect(workspace).not.toHaveBeenCalled()
    expect(approve).not.toHaveBeenCalled()
  })
  it.each(['ask', 'accept-edits'] as const)(
    'asks once before external edits in %s mode',
    async (mode) => {
      const workspace = vi.fn().mockRejectedValue(new PathDeniedError('outside'))
      const approve = vi.fn().mockResolvedValue(true)
      await expect(assertAgentFilePermission(target, mode, workspace, approve)).resolves.toBe(
        target
      )
      expect(approve).toHaveBeenCalledExactlyOnceWith(target)
    }
  )
  it('runs workspace edits without asking', async () => {
    const approve = vi.fn()
    await assertAgentFilePermission(target, 'ask', async () => target, approve)
    expect(approve).not.toHaveBeenCalled()
  })
  it('blocks declined external edits and unrelated filesystem errors', async () => {
    await expect(
      assertAgentFilePermission(
        target,
        'ask',
        async () => {
          throw new PathDeniedError('outside')
        },
        async () => false
      )
    ).rejects.toThrow('outside')
    const approve = vi.fn()
    await expect(
      assertAgentFilePermission(
        target,
        'ask',
        async () => {
          throw new Error('unavailable')
        },
        approve
      )
    ).rejects.toThrow('unavailable')
    expect(approve).not.toHaveBeenCalled()
  })
  it('does not execute when terminated while approval is open', async () => {
    const controller = new AbortController()
    await expect(
      assertAgentFilePermission(
        target,
        'ask',
        async () => {
          throw new PathDeniedError('outside')
        },
        async () => {
          controller.abort()
          return true
        },
        controller.signal
      )
    ).rejects.toThrow()
  })
})

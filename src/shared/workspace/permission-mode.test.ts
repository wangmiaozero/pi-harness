import { describe, expect, it } from 'vitest'
import { normalizePermissionMode, toolNeedsApproval } from './permission-mode'

describe('permission mode', () => {
  it('normalizes unknown values to auto', () => {
    expect(normalizePermissionMode('ask')).toBe('ask')
    expect(normalizePermissionMode('accept-edits')).toBe('accept-edits')
    expect(normalizePermissionMode('auto')).toBe('auto')
    expect(normalizePermissionMode('yolo')).toBe('auto')
    expect(normalizePermissionMode(undefined)).toBe('auto')
  })

  it('always allows read-only tools in every mode', () => {
    for (const mode of ['ask', 'accept-edits', 'auto'] as const) {
      expect(toolNeedsApproval('read', mode)).toBe(false)
      expect(toolNeedsApproval('grep', mode)).toBe(false)
    }
  })

  it('auto never asks', () => {
    expect(toolNeedsApproval('bash', 'auto')).toBe(false)
    expect(toolNeedsApproval('write', 'auto')).toBe(false)
  })

  it('uses the host guard for built-in file and command tools', () => {
    expect(toolNeedsApproval('write', 'accept-edits')).toBe(false)
    expect(toolNeedsApproval('edit', 'accept-edits')).toBe(false)
    expect(toolNeedsApproval('bash', 'accept-edits')).toBe(false)
    expect(toolNeedsApproval('webfetch', 'accept-edits')).toBe(true)
  })

  it('asks about unclassified tools and delegates known tools to the host', () => {
    expect(toolNeedsApproval('write', 'ask')).toBe(false)
    expect(toolNeedsApproval('bash', 'ask')).toBe(false)
    expect(toolNeedsApproval('custom-tool', 'ask')).toBe(true)
    expect(toolNeedsApproval('read', 'ask')).toBe(false)
  })
})

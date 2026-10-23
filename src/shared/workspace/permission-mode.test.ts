import { describe, expect, it } from 'vitest'
import {
  normalizePermissionMode,
  toolNeedsApproval
} from './permission-mode'

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

  it('accept-edits allows file edits and asks for the rest', () => {
    expect(toolNeedsApproval('write', 'accept-edits')).toBe(false)
    expect(toolNeedsApproval('edit', 'accept-edits')).toBe(false)
    expect(toolNeedsApproval('bash', 'accept-edits')).toBe(true)
    expect(toolNeedsApproval('webfetch', 'accept-edits')).toBe(true)
  })

  it('ask gates every non-read-only tool', () => {
    expect(toolNeedsApproval('write', 'ask')).toBe(true)
    expect(toolNeedsApproval('bash', 'ask')).toBe(true)
    expect(toolNeedsApproval('read', 'ask')).toBe(false)
  })
})

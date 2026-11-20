import { describe, expect, it } from 'vitest'
import { shouldRemindUpdate } from './update'

const base = {
  available: true,
  status: 'manual_fallback' as const,
  latestVersion: '9.0.0',
  currentVersion: '2.4.14'
}

describe('shouldRemindUpdate', () => {
  it('reminds while a newer version is still uninstalled', () => {
    expect(shouldRemindUpdate(base, null)).toBe(true)
    expect(shouldRemindUpdate({ ...base, status: 'available' }, null)).toBe(true)
    expect(shouldRemindUpdate({ ...base, status: 'ready_to_install' }, null)).toBe(true)
  })

  it('stays quiet after the user closes the dialog for this launch only', () => {
    expect(shouldRemindUpdate(base, '9.0.0')).toBe(false)
    expect(shouldRemindUpdate({ ...base, latestVersion: '9.0.1' }, '9.0.0')).toBe(true)
  })

  it('does not remind when the app is already current or the check failed', () => {
    expect(shouldRemindUpdate({ ...base, available: false, status: 'idle' }, null)).toBe(false)
    expect(shouldRemindUpdate({ ...base, status: 'failed' }, null)).toBe(false)
    expect(shouldRemindUpdate(null, null)).toBe(false)
  })
})
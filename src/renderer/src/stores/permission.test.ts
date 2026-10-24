import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePermissionStore } from './permission'

vi.mock('./settings', () => ({
  useSettingsStore: () => ({ settings: { defaultPermissionMode: 'auto' } })
}))
vi.mock('@renderer/composables/useApi', () => ({
  getApi: () => ({ on: () => () => {}, agent: { setPermissionMode: vi.fn() } }),
  callApi: (call: () => unknown) => Promise.resolve(call())
}))

describe('permission selection', () => {
  beforeEach(() => setActivePinia(createPinia()))
  it('keeps the selected draft mode separate from session choices', () => {
    const store = usePermissionStore()
    expect(store.modeFor(null)).toBe('auto')
    store.setMode(null, 'ask')
    expect(store.modeFor(null)).toBe('ask')
    expect(store.modeFor('other')).toBe('auto')
    store.setMode('session', 'accept-edits')
    expect(store.modeFor('session')).toBe('accept-edits')
    expect(store.modeFor(null)).toBe('ask')
  })
})

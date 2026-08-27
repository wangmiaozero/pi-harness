import { describe, expect, it } from 'vitest'
import { reactive } from 'vue'
import { DEFAULT_NAV_ORDER } from '@shared/constants/navigation'
import { toIpcSettingsPatch } from './settings-patch'

describe('toIpcSettingsPatch', () => {
  it('clones reactive navOrder so Electron IPC can structuredClone it', () => {
    const patch = reactive({
      theme: 'dark' as const,
      navOrder: ['settings' as const, ...DEFAULT_NAV_ORDER.filter((id) => id !== 'settings')]
    })
    expect(() => structuredClone(patch)).toThrow()
    const cloned = toIpcSettingsPatch(patch)
    expect(() => structuredClone(cloned)).not.toThrow()
    expect(cloned.navOrder?.[0]).toBe('settings')
    expect(cloned.navOrder).toHaveLength(DEFAULT_NAV_ORDER.length)
  })
})

import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import PetPackManager from './PetPackManager.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('vue-sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

describe('PetPackManager', () => {
  it('keeps the saved pet without a placeholder when its pack is absent', async () => {
    const wrapper = mount(PetPackManager, {
      props: { modelValue: 'bigfish' },
      global: { mocks: { $t: (key: string) => key } }
    })
    await flushPromises()
    expect(wrapper.find('[data-testid="pet-pack-missing"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('settings.marketPackMissing')
    expect(wrapper.find('[data-testid="pet-import-zip"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="pet-remove-pack"]').exists()).toBe(false)
    expect(wrapper.emitted('ready')?.at(-1)).toEqual([false])
    expect(wrapper.props('modelValue')).toBe('bigfish')
    wrapper.unmount()
  })
})

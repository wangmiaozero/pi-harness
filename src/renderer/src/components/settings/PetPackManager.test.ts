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
  it('shows installed pets as selectable cards and switches the active pet', async () => {
    const setActive = vi.fn().mockResolvedValue(undefined)
    const pack = (id: string, name: string, bundled: boolean) => ({
      id,
      name,
      nameEn: name,
      author: 'Pi',
      version: '1.0.0',
      license: 'MIT',
      bundled,
      compatible: true,
      clipCount: 1,
      baseWidth: 1,
      baseHeight: 1,
      fps: 1
    })
    vi.stubGlobal('piSwitch', {
      pets: {
        list: vi.fn().mockResolvedValue([pack('bigfish', 'BigFish', true), pack('cat', 'Cat', false)]),
        setActive
      }
    })
    const wrapper = mount(PetPackManager, {
      props: { modelValue: 'bigfish' },
      global: { mocks: { $t: (key: string) => key } }
    })
    await flushPromises()
    const cards = wrapper.findAll('[data-pet-pack-option]')
    expect(cards).toHaveLength(2)
    expect(wrapper.get('[data-pet-pack-option="bigfish"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('[data-pet-pack-option="bigfish"]').text()).toContain(
      'settings.petPackBundledBadge'
    )
    await wrapper.get('[data-pet-pack-option="cat"]').trigger('click')
    await flushPromises()
    expect(setActive).toHaveBeenCalledWith('cat')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['cat'])
    expect(wrapper.find('[data-testid="pet-remove-pack"]').exists()).toBe(true)
    wrapper.unmount()
    vi.unstubAllGlobals()
  })
})

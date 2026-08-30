import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { i18n } from '@renderer/i18n'
import { usePetStore } from '@renderer/stores/pet'
import { PET_MANIFESTS } from '@renderer/pet/manifests'
import PortraitSkinPanel from './PortraitSkinPanel.vue'

beforeEach(() => setActivePinia(createPinia()))

describe('portrait skin panel', () => {
  it.each(['noirScholar', 'moonlitMaid'] as const)(
    'keeps %s art and status together without changing pet state',
    async (style) => {
      const pet = usePetStore()
      const wrapper = mount(PortraitSkinPanel, {
        props: { style, showStatus: true },
        global: { plugins: [i18n] }
      })
      expect(wrapper.get('img').attributes('src')).toBe(PET_MANIFESTS[style].sprite)
      expect(wrapper.get('aside').attributes('aria-hidden')).toBe('true')
      expect(wrapper.find('button').exists()).toBe(false)
      const character = wrapper.get('.portrait-skin-character')
      expect(character.find('[data-testid="portrait-skin-image"]').exists()).toBe(true)
      expect(character.find('[data-testid="pet-status-bubble"]').exists()).toBe(true)
      pet.state = 'thinking'
      await wrapper.vm.$nextTick()
      expect(wrapper.get('[data-testid="pet-status-bubble"]').attributes('data-state')).toBe(
        'thinking'
      )
      await wrapper.setProps({ showStatus: false })
      expect(wrapper.find('[data-testid="pet-status-bubble"]').exists()).toBe(false)
      expect(pet.state).toBe('thinking')
    }
  )

  it('contains missing assets locally and retries when switching skins', async () => {
    const wrapper = mount(PortraitSkinPanel, {
      props: { style: 'noirScholar', showStatus: false },
      global: { plugins: [i18n] }
    })
    await wrapper.get('img').trigger('error')
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.get('.portrait-skin-fallback').text()).toBe('π')
    await wrapper.setProps({ style: 'moonlitMaid' })
    expect(wrapper.get('img').attributes('src')).toBe(PET_MANIFESTS.moonlitMaid.sprite)
    expect(wrapper.find('.portrait-skin-fallback').exists()).toBe(false)
  })
})

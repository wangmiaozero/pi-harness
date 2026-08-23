import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { singleFrameAnimation } from '@shared/pet/animations'
import type { PetManifest } from '@shared/pet/types'
import PetRenderer from './PetRenderer.vue'

const manifest: PetManifest = {
  id: 'maidWhite',
  name: 'Maid',
  sprite: '/pet.png',
  frameWidth: 100,
  frameHeight: 150,
  columns: 1,
  rows: 1,
  accent: '#fff',
  animations: {
    idle: singleFrameAnimation('idle'),
    running: singleFrameAnimation('running')
  }
}

describe('PetRenderer', () => {
  it('exposes runtime and fallback animation state', () => {
    const wrapper = mount(PetRenderer, { props: { manifest, state: 'coding' } })
    const root = wrapper.get('[data-pet-state]')

    expect(root.attributes('data-pet-state')).toBe('coding')
    expect(root.attributes('data-animation-state')).toBe('running')
    expect(root.attributes('data-theme')).toBe('maidWhite')
  })

  it('isolates resource failures and renders a stable fallback', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const wrapper = mount(PetRenderer, { props: { manifest, state: 'idle' } })
    await wrapper.get('img').trigger('error')

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.get('.pet-fallback').text()).toBe('π')
    expect(wrapper.emitted('resourceError')).toEqual([['maidWhite']])
    expect(warning).toHaveBeenCalledOnce()
    warning.mockRestore()
  })

  it('disables motion without changing the visible state', () => {
    const wrapper = mount(PetRenderer, {
      props: { manifest, state: 'thinking', animated: false }
    })
    expect(wrapper.classes()).toContain('pet-motion-off')
    expect(wrapper.attributes('data-pet-state')).toBe('thinking')
  })
})

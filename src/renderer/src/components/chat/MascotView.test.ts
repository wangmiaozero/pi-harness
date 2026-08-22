import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MascotView from './MascotView.vue'
import { MASCOT_STYLES } from '@shared/constants/mascot'

describe('MascotView', () => {
  it('renders no image for the none style', () => {
    const wrapper = mount(MascotView, { props: { style: 'none' } })

    expect(wrapper.find('[data-testid="workspace-mascot"]').exists()).toBe(false)
    expect(wrapper.find('img').exists()).toBe(false)
  })

  it('renders every visual style', async () => {
    const wrapper = mount(MascotView, { props: { style: 'knowledge' } })

    for (const style of MASCOT_STYLES.filter((style) => style !== 'none')) {
      await wrapper.setProps({ style })
      expect(wrapper.get('[data-testid="workspace-mascot"]').attributes('data-style')).toBe(style)
      const assetName = style === 'maidWhite' ? 'pico-maid-white' : `pico-${style}`
      expect(wrapper.get('img').attributes('src')).toContain(assetName)
    }
  })

  it('reflects the active state without exposing decorative content', () => {
    const wrapper = mount(MascotView, { props: { style: 'knowledge', active: true } })
    const mascot = wrapper.get('[data-testid="workspace-mascot"]')

    expect(mascot.attributes('data-active')).toBe('true')
    expect(mascot.attributes('aria-hidden')).toBe('true')
    expect(wrapper.get('img').attributes('alt')).toBe('')
  })
})

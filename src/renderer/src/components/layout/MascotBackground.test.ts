import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MascotBackground from './MascotBackground.vue'
import { MASCOT_STYLES } from '@shared/constants/mascot'

describe('MascotBackground', () => {
  it('renders no image for the none style', () => {
    const wrapper = mount(MascotBackground, { props: { style: 'none' } })

    expect(wrapper.find('[data-testid="page-mascot-background"]').exists()).toBe(false)
    expect(wrapper.find('img').exists()).toBe(false)
  })

  it('renders every visual style as decorative content', async () => {
    const wrapper = mount(MascotBackground, { props: { style: 'knowledge' } })

    for (const style of MASCOT_STYLES.filter((style) => style !== 'none')) {
      await wrapper.setProps({ style })
      const background = wrapper.get('[data-testid="page-mascot-background"]')
      expect(background.attributes('data-style')).toBe(style)
      expect(background.attributes('aria-hidden')).toBe('true')
      const assetName = style === 'maidWhite' ? 'pico-maid-white' : `pico-${style}`
      expect(wrapper.get('img').attributes('src')).toContain(assetName)
      expect(wrapper.get('img').attributes('alt')).toBe('')
    }
  })
})

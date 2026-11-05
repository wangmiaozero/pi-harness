import { mount } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import SwitchControl from './Switch.vue'

describe('Switch', () => {
  it('keeps the thumb vertically centered in both positions', async () => {
    const on = mount(SwitchControl, { props: { modelValue: true } })
    expect(on.get('span').attributes('style')).toContain('translate(13px, -50%)')

    const Host = defineComponent({
      components: { SwitchControl },
      setup() {
        return { value: ref(true) }
      },
      template: '<SwitchControl v-model="value" />'
    })
    const wrapper = mount(Host)
    expect(wrapper.get('span').attributes('style')).toContain('translate(13px, -50%)')
    await wrapper.get('button').trigger('click')
    expect(wrapper.get('span').attributes('style')).toContain('translate(1px, -50%)')
  })
})

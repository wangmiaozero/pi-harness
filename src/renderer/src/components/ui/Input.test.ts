import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import Input from './Input.vue'

describe('Input secret reveal control', () => {
  it('keeps revealable values masked until the parent confirms reveal', async () => {
    const wrapper = mount(Input, {
      props: {
        modelValue: 'secret-value',
        revealable: true,
        revealed: false,
        revealLabel: 'Reveal API key',
        hideLabel: 'Hide API key'
      }
    })

    expect(wrapper.get('input').attributes('type')).toBe('password')
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('reveal-toggle')).toHaveLength(1)

    await wrapper.setProps({ revealed: true })
    expect(wrapper.get('input').attributes('type')).toBe('text')
    expect(wrapper.get('button').attributes('aria-label')).toBe('Hide API key')
  })
})

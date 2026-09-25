import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import Combobox from './Combobox.vue'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('Combobox', () => {
  it('shows every option from the dropdown button when custom text has no match', async () => {
    const wrapper = mount(Combobox, {
      attachTo: document.body,
      props: {
        modelValue: 'custom-model',
        options: [
          { value: 'glm-5.3', label: 'GLM 5.3' },
          { value: 'kimi-k3', label: 'Kimi K3' }
        ]
      }
    })

    await wrapper.get('button').trigger('mousedown')
    await nextTick()

    const panel = document.body.querySelector('[data-combobox-panel]')
    expect(panel?.textContent).toContain('GLM 5.3')
    expect(panel?.textContent).toContain('Kimi K3')
  })

  it('keeps text input filtering behavior', async () => {
    const wrapper = mount(Combobox, {
      attachTo: document.body,
      props: {
        modelValue: '',
        options: [
          { value: 'glm-5.3', label: 'GLM 5.3' },
          { value: 'kimi-k3', label: 'Kimi K3' }
        ]
      }
    })

    await wrapper.get('input').setValue('kimi')
    await nextTick()

    const panel = document.body.querySelector('[data-combobox-panel]')
    expect(panel?.textContent).not.toContain('GLM 5.3')
    expect(panel?.textContent).toContain('Kimi K3')
  })

  it('does not render a misleading dropdown button without suggestions', () => {
    const wrapper = mount(Combobox, {
      props: {
        modelValue: 'custom-model',
        options: []
      }
    })

    expect(wrapper.find('input').exists()).toBe(true)
    expect(wrapper.find('button').exists()).toBe(false)
  })
})

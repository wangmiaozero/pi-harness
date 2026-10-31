import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import Combobox from './Combobox.vue'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('Combobox', () => {
  it('dismisses suggestions with Escape before allowing the containing dialog to handle it', async () => {
    const wrapper = mount(Combobox, {
      attachTo: document.body,
      props: { modelValue: '', options: [{ value: 'fixture', label: 'Fixture' }] }
    })
    const parentKey = vi.fn()
    wrapper.element.addEventListener('keydown', parentKey)
    const input = wrapper.get('input')
    await input.trigger('focus')
    expect(document.body.querySelector('[data-combobox-panel]')).not.toBeNull()
    await input.trigger('keydown', { key: 'Escape' })
    expect(document.body.querySelector('[data-combobox-panel]')).toBeNull()
    expect(parentKey).not.toHaveBeenCalled()
    await input.trigger('keydown', { key: 'Escape' })
    expect(parentKey).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

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

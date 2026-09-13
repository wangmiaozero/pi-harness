import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import Select from './Select.vue'

const wrappers: VueWrapper[] = []

afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  document.body.innerHTML = ''
})

describe('Select', () => {
  it('renders grouped options as provider and model levels', async () => {
    const wrapper = mount(Select, {
      attachTo: document.body,
      props: {
        modelValue: 'nvidia/minimax-m3',
        options: [
          { value: 'nvidia/minimax-m3', label: 'MiniMax M3', group: 'NVIDIA' },
          { value: 'nvidia/glm-5.2', label: 'GLM 5.2', group: 'NVIDIA' },
          { value: 'openai/gpt-5', label: 'GPT-5', group: 'OpenAI' }
        ]
      }
    })
    wrappers.push(wrapper)

    expect(wrapper.get('button').text()).toContain('NVIDIA / MiniMax M3')
    await wrapper.get('button').trigger('click')

    const groups = Array.from(document.body.querySelectorAll('[role="group"]'))
    expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual(['NVIDIA', 'OpenAI'])
    expect(groups[0]?.querySelectorAll('[role="option"]')).toHaveLength(2)
    expect(groups[1]?.querySelectorAll('[role="option"]')).toHaveLength(1)
    expect(groups[0]?.textContent).toContain('NVIDIA')
    expect(groups[1]?.textContent).toContain('OpenAI')
  })

  it('emits the selected child model value', async () => {
    const wrapper = mount(Select, {
      attachTo: document.body,
      props: {
        modelValue: 'nvidia/minimax-m3',
        options: [
          { value: 'nvidia/minimax-m3', label: 'MiniMax M3', group: 'NVIDIA' },
          { value: 'openai/gpt-5', label: 'GPT-5', group: 'OpenAI' }
        ]
      }
    })
    wrappers.push(wrapper)

    await wrapper.get('button').trigger('click')
    const option = Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]')).find(
      (element) => element.textContent?.includes('GPT-5')
    )
    option?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))

    expect(wrapper.emitted('update:modelValue')).toEqual([['openai/gpt-5']])
  })

  it('applies the compact trigger classes when size is sm', () => {
    const wrapper = mount(Select, {
      props: {
        modelValue: 'a',
        'aria-label': 'Choose option',
        size: 'sm',
        options: [
          { value: 'a', label: 'Option A' },
          { value: 'b', label: 'Option B' }
        ]
      }
    })
    wrappers.push(wrapper)

    const trigger = wrapper.get('button')
    expect(trigger.classes()).toContain('h-7')
    expect(trigger.classes()).toContain('text-[11.5px]')
    expect(trigger.attributes('aria-label')).toBe('Choose option')
  })

  it('opens cascade groups as a side flyout of models', async () => {
    const wrapper = mount(Select, {
      attachTo: document.body,
      props: {
        cascade: true,
        modelValue: 'nvidia/minimax-m3',
        options: [
          { value: 'nvidia/minimax-m3', label: 'MiniMax M3', group: 'NVIDIA' },
          { value: 'nvidia/glm-5.2', label: 'GLM 5.2', group: 'NVIDIA' },
          { value: 'openai/gpt-5', label: 'GPT-5', group: 'OpenAI' }
        ]
      }
    })
    wrappers.push(wrapper)

    await wrapper.get('button').trigger('click')

    const vendors = Array.from(
      document.body.querySelectorAll<HTMLElement>('[data-select-cascade-group]')
    )
    expect(vendors.map((vendor) => vendor.dataset.selectCascadeGroup)).toEqual(['NVIDIA', 'OpenAI'])
    expect(document.body.querySelector('[role="group"]')).toBeNull()

    const submenu = document.body.querySelector('[data-select-cascade-submenu]')
    expect(submenu?.textContent).toContain('MiniMax M3')
    expect(submenu?.textContent).toContain('GLM 5.2')
    expect(submenu?.textContent).not.toContain('GPT-5')

    vendors[1]?.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))
    await wrapper.vm.$nextTick()

    const flyout = document.body.querySelector('[data-select-cascade-submenu]')
    expect(flyout?.textContent).toContain('GPT-5')
    expect(flyout?.textContent).not.toContain('MiniMax M3')

    const option = Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]')).find(
      (element) => element.textContent?.includes('GPT-5')
    )
    option?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))

    expect(wrapper.emitted('update:modelValue')).toEqual([['openai/gpt-5']])
  })

  it('supports keyboard navigation without opening a native popup', async () => {
    const wrapper = mount(Select, {
      attachTo: document.body,
      props: {
        modelValue: 'a',
        options: [
          { value: 'a', label: 'Option A' },
          { value: 'b', label: 'Option B' },
          { value: 'c', label: 'Option C', disabled: true }
        ]
      }
    })
    wrappers.push(wrapper)

    const trigger = wrapper.get('button')
    await trigger.trigger('keydown', { key: 'ArrowDown' })
    await trigger.trigger('keydown', { key: 'ArrowDown' })
    await trigger.trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('update:modelValue')).toEqual([['b']])
    expect(document.body.querySelector('select')).toBeNull()
  })
})

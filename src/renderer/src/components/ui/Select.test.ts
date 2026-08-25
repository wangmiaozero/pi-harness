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
})

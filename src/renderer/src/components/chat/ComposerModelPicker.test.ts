import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { i18n } from '@renderer/i18n'
import ComposerModelPicker from './ComposerModelPicker.vue'

const wrappers: VueWrapper[] = []

afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  document.body.innerHTML = ''
})

const OPTIONS = [
  { value: 'nvidia/minimax-m3', label: 'MiniMax M3', group: 'NVIDIA' },
  { value: 'nvidia/glm-5.2', label: 'GLM 5.2', group: 'NVIDIA' },
  { value: 'openai/gpt-5', label: 'GPT-5', group: 'OpenAI' }
]

function mountPicker(thinking = 'medium') {
  const wrapper = mount(ComposerModelPicker, {
    attachTo: document.body,
    props: {
      model: 'nvidia/minimax-m3',
      thinking,
      options: OPTIONS
    },
    global: { plugins: [i18n] }
  })
  wrappers.push(wrapper)
  return wrapper
}

describe('ComposerModelPicker', () => {
  it('opens vendor flyout then searchable models with a thinking slider', async () => {
    const wrapper = mountPicker()
    expect(wrapper.get('button').text()).toContain('NVIDIA / MiniMax M3 · medium')

    await wrapper.get('button').trigger('click')
    const vendors = Array.from(
      document.body.querySelectorAll<HTMLElement>('[data-select-cascade-group]')
    )
    expect(vendors.map((vendor) => vendor.dataset.selectCascadeGroup)).toEqual(['NVIDIA', 'OpenAI'])
    expect(document.body.querySelector('[role="listbox"]')?.textContent).toContain('MiniMax M3')
    expect(document.body.querySelector('[data-testid="composer-thinking-slider"]')).toBeTruthy()
    expect(document.body.textContent).toContain(
      String(i18n.global.t('workspace.thinkingIntensity'))
    )
    expect(document.body.textContent).toContain('medium')
    expect(document.body.textContent).toContain(String(i18n.global.t('workspace.thinkingFaster')))

    vendors[1]?.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(document.body.querySelector('[role="listbox"]')?.textContent).toContain('GPT-5')
    expect(document.body.querySelector('[role="listbox"]')?.textContent).not.toContain('MiniMax M3')
  })

  it('filters models and keeps the panel open after a pick', async () => {
    const wrapper = mountPicker()
    await wrapper.get('button').trigger('click')

    const search = document.body.querySelector<HTMLInputElement>(
      '[data-testid="composer-model-search"]'
    )
    expect(search).toBeTruthy()
    search!.value = 'glm'
    search!.dispatchEvent(new Event('input', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(document.body.querySelector('[role="listbox"]')?.textContent).toContain('GLM 5.2')
    expect(document.body.querySelector('[role="listbox"]')?.textContent).not.toContain('MiniMax M3')

    const option = Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]')).find(
      (element) => element.textContent?.includes('GLM 5.2')
    )
    option?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('update:model')).toEqual([['nvidia/glm-5.2']])
    expect(document.body.querySelector('[data-testid="composer-model-panel"]')).toBeTruthy()
  })
})

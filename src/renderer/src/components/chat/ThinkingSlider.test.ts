import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { i18n } from '@renderer/i18n'
import ThinkingSlider from './ThinkingSlider.vue'

const wrappers: VueWrapper[] = []

afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
})

describe('ThinkingSlider', () => {
  it('steps through thinking levels with the keyboard', async () => {
    const wrapper = mount(ThinkingSlider, {
      props: { modelValue: 'medium' },
      global: { plugins: [i18n] }
    })
    wrappers.push(wrapper)

    const slider = wrapper.get('[data-testid="composer-thinking-slider"]')
    expect(slider.attributes('aria-valuetext')).toBe('medium')
    await slider.trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['high'])
    await slider.trigger('keydown', { key: 'Home' })
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['auto'])
    await slider.trigger('keydown', { key: 'End' })
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['ultra'])
  })

  it('shows a weaker overlay at medium and the max overlay on the last stop', async () => {
    const mid = mount(ThinkingSlider, {
      props: { modelValue: 'medium' },
      global: { plugins: [i18n] }
    })
    wrappers.push(mid)
    expect(mid.find('canvas').exists()).toBe(true)
    expect(mid.find('[data-thinking-max="true"]').exists()).toBe(false)

    const peak = mount(ThinkingSlider, {
      props: { modelValue: 'max' },
      global: { plugins: [i18n] }
    })
    wrappers.push(peak)
    expect(peak.find('[data-thinking-max="true"]').exists()).toBe(true)
    const decree = peak.get('[data-testid="composer-thinking-forbidden"]')
    expect(decree.text()).toBe(String(i18n.global.t('workspace.thinkingForbiddenPower')))
    expect(decree.find('.thinking-forbidden__text').exists()).toBe(true)
    expect(decree.find('.thinking-forbidden__halo').exists()).toBe(true)
    expect(decree.find('.thinking-forbidden__rays').exists()).toBe(true)
    expect(decree.findAll('.thinking-forbidden__spark')).toHaveLength(9)
    expect(peak.get('[data-testid="composer-thinking-slider"]').attributes('aria-valuetext')).toBe(
      String(i18n.global.t('workspace.thinkingForbiddenPower'))
    )

    const ultra = mount(ThinkingSlider, {
      props: { modelValue: 'ultra' },
      global: { plugins: [i18n] }
    })
    wrappers.push(ultra)
    expect(ultra.find('[data-thinking-ultra="true"]').exists()).toBe(true)
    expect(ultra.findAll('.thinking-forbidden__spark')).toHaveLength(15)
    expect(ultra.get('[data-testid="composer-thinking-slider"]').classes()).toContain(
      'thinking-slider--ultra'
    )
    expect(ultra.find('.thinking-slider-stage--ultra').exists()).toBe(true)
    expect(ultra.get('[data-testid="composer-thinking-forbidden"]').text()).toBe(
      String(i18n.global.t('workspace.thinkingForbiddenPower'))
    )
  })

  it('announces the divine-audience decree for GPT 5.6+ on ultra', async () => {
    const wrapper = mount(ThinkingSlider, {
      props: { modelValue: 'ultra', modelId: 'openai/gpt-5.6' },
      global: { plugins: [i18n] }
    })
    wrappers.push(wrapper)
    expect(wrapper.get('[data-testid="composer-thinking-forbidden"]').text()).toBe(
      String(i18n.global.t('workspace.thinkingDivineAudience'))
    )
    expect(
      wrapper.get('[data-testid="composer-thinking-slider"]').attributes('aria-valuetext')
    ).toBe(String(i18n.global.t('workspace.thinkingDivineAudience')))
  })

  it('keeps the forbidden-power decree for GPT 5.6 on max and for other ultra models', async () => {
    const maxGpt = mount(ThinkingSlider, {
      props: { modelValue: 'max', modelId: 'openai/gpt-5.6' },
      global: { plugins: [i18n] }
    })
    wrappers.push(maxGpt)
    expect(maxGpt.get('[data-testid="composer-thinking-forbidden"]').text()).toBe(
      String(i18n.global.t('workspace.thinkingForbiddenPower'))
    )

    const ultraGlm = mount(ThinkingSlider, {
      props: { modelValue: 'ultra', modelId: 'volcengine-coding/glm-5.3' },
      global: { plugins: [i18n] }
    })
    wrappers.push(ultraGlm)
    expect(ultraGlm.get('[data-testid="composer-thinking-forbidden"]').text()).toBe(
      String(i18n.global.t('workspace.thinkingForbiddenPower'))
    )
  })

  it('announces the forbidden-power hint after dragging to max', async () => {
    const wrapper = mount(ThinkingSlider, {
      props: { modelValue: 'high' },
      global: { plugins: [i18n] }
    })
    wrappers.push(wrapper)
    expect(wrapper.find('[data-testid="composer-thinking-forbidden"]').exists()).toBe(false)

    await wrapper.get('[data-testid="composer-thinking-slider"]').trigger('keydown', { key: 'End' })
    await wrapper.setProps({ modelValue: 'max' })
    expect(wrapper.get('[data-testid="composer-thinking-forbidden"]').text()).toBe(
      String(i18n.global.t('workspace.thinkingForbiddenPower'))
    )
  })

  it('does not emit the same level twice', async () => {
    const wrapper = mount(ThinkingSlider, {
      props: { modelValue: 'ultra' },
      global: { plugins: [i18n] }
    })
    wrappers.push(wrapper)
    await wrapper.get('[data-testid="composer-thinking-slider"]').trigger('keydown', { key: 'End' })
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})

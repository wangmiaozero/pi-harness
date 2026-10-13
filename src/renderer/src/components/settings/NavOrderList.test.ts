import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { expect, it } from 'vitest'
import { DEFAULT_NAV_ORDER } from '@shared/constants/navigation'
import { messages } from '@renderer/i18n'
import NavOrderList from './NavOrderList.vue'

it('uses translated navigation names for every supported language and preserves keyboard ordering', async () => {
  for (const locale of Object.keys(messages) as Array<keyof typeof messages>) {
    const i18n = createI18n({ legacy: false, locale, fallbackLocale: 'en-US', messages })
    const wrapper = mount(NavOrderList, {
      props: { modelValue: [...DEFAULT_NAV_ORDER] },
      global: { plugins: [i18n] }
    })
    const history = wrapper.get('[data-nav-id="ai-sessions"]')
    expect(history.text()).toContain(messages[locale].nav.aiSessions)
    expect(history.attributes('aria-label')).toBe(messages[locale].nav.aiSessions)
    expect(wrapper.text()).not.toContain('nav.')
    await history.trigger('keydown', { key: 'ArrowDown' })
    expect(wrapper.emitted('update:modelValue')?.[0]?.[0]).toEqual([
      'workspace',
      'git',
      'models',
      'ai-sessions',
      'skills',
      'settings'
    ])
    wrapper.unmount()
  }
})

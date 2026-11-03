import { expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import type { AppSettings } from '@shared/ipc/api-types'
import { SETTINGS_DRAFT_KEY } from './draft-key'
import NavSettingsSection from './NavSettingsSection.vue'
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

it('reorders only overflow entries and preserves legacy primary/settings slots', async () => {
  const draft = ref({
    navOrder: ['skills', 'settings', 'models', 'git', 'workspace', 'ai-sessions']
  } as AppSettings)
  const wrapper = mount(NavSettingsSection, {
    global: {
      provide: { [SETTINGS_DRAFT_KEY as symbol]: draft },
      mocks: { $t: (key: string) => key }
    }
  })
  try {
    const items = wrapper.findAll('[data-testid="nav-order-item"]')
    expect(items.map((item) => item.attributes('data-nav-id'))).toEqual([
      'skills',
      'git',
      'ai-sessions'
    ])
    await items[0]!.trigger('keydown', { key: 'ArrowDown' })
    expect(draft.value.navOrder).toEqual([
      'git',
      'settings',
      'models',
      'skills',
      'workspace',
      'ai-sessions'
    ])
    await wrapper.get('[data-testid="nav-order-reset"]').trigger('click')
    expect(draft.value.navOrder).toEqual([
      'git',
      'settings',
      'models',
      'ai-sessions',
      'workspace',
      'skills'
    ])
  } finally {
    wrapper.unmount()
  }
})

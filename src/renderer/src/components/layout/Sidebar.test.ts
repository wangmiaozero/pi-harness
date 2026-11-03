import { afterEach, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import Sidebar from './Sidebar.vue'

vi.mock('@renderer/stores/settings', () => ({
  useSettingsStore: () => ({
    settings: { navOrder: ['skills', 'settings', 'models', 'git', 'workspace', 'ai-sessions'] }
  })
}))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
const wrappers: ReturnType<typeof mount>[] = []
afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount())
  wrappers.length = 0
  localStorage.clear()
})
async function render(route: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }]
  })
  await router.push(route)
  const wrapper = mount(Sidebar, { global: { plugins: [router] } })
  wrappers.push(wrapper)
  return wrapper
}
it.each(['[]', '["git","skills"]', 'not json'])(
  'keeps Home and Models fixed despite legacy order and pin state (%s)',
  async (pins) => {
    localStorage.setItem('pi-harness.navigation-pins.v1', pins)
    const wrapper = await render('/workspace')
    expect(wrapper.findAll('nav a').map((link) => link.attributes('href'))).toEqual([
      '/workspace',
      '/models'
    ])
    expect(wrapper.findAll('nav a')[0]!.attributes('aria-label')).toBe('nav.home')
    expect(wrapper.get('[data-testid="navigation-settings"]').attributes('href')).toBe('/settings')
    for (const link of wrapper.findAll('a')) {
      expect(link.text()).toBe('')
      expect(link.attributes('aria-label')).toMatch(/^nav\./)
    }
  }
)
it.each(['/git', '/ai-sessions', '/skills'])('marks More active for %s', async (route) => {
  const wrapper = await render(route)
  expect(wrapper.get('[data-testid="navigation-more"]').classes()).toContain(
    'bg-[var(--bg-surface-raised)]'
  )
})
it('keeps Settings selected separately from More', async () => {
  const wrapper = await render('/settings/general')
  expect(wrapper.get('[data-testid="navigation-settings"]').classes()).toContain(
    'bg-[var(--bg-surface-raised)]'
  )
  expect(wrapper.get('[data-testid="navigation-more"]').classes()).not.toContain(
    'bg-[var(--bg-surface-raised)]'
  )
})

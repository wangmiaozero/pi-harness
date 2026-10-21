import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { i18n } from '@renderer/i18n'
import type { PiSwitchAPI } from '@shared/ipc/api-types'
import type { PluginDescriptor } from '@shared/harness-plugins/types'
import { pluginManifestSchema } from '@shared/harness-plugins/schema'
import HarnessPluginsPanel from './HarnessPluginsPanel.vue'

let wrapper: VueWrapper | undefined
const previousLocale = i18n.global.locale.value
beforeEach(() => {
  setActivePinia(createPinia())
  i18n.global.locale.value = 'en-US'
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  delete window.piSwitch
  i18n.global.locale.value = previousLocale
})
function api(list = vi.fn(async () => [] as PluginDescriptor[])) {
  const installLocal = vi.fn(async () => null as PluginDescriptor | null)
  window.piSwitch = { harnessPlugins: { list, installLocal } } as unknown as PiSwitchAPI
  wrapper = mount(HarnessPluginsPanel, { global: { plugins: [i18n] } })
  return { list, installLocal }
}
it('shows local-folder guidance and busy feedback, prevents repeated installation, then recovers from failure', async () => {
  const { installLocal } = api()
  await flushPromises()
  expect(wrapper!.text()).toContain('plugin.json')
  let reject!: (error: Error) => void
  installLocal.mockImplementation(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail
      })
  )
  const button = wrapper!.get('[data-testid="harness-plugin-install"]')
  await button.trigger('click')
  await button.trigger('click')
  expect(installLocal).toHaveBeenCalledTimes(1)
  expect(button.attributes('disabled')).toBeDefined()
  expect(wrapper!.get('[role="status"]').text()).toContain('Working')
  reject(new Error('Invalid plugin.json'))
  await flushPromises()
  expect(wrapper!.get('[role="alert"]').text()).toContain('Invalid plugin.json')
  expect(button.attributes('disabled')).toBeUndefined()
})
it('explains the exact required and available SDK versions and blocks incompatible activation', async () => {
  const manifest = pluginManifestSchema.parse({
    id: 'org.test.incompatible',
    name: 'Incompatible',
    version: '1.0.0',
    apiVersion: '^2.0.0',
    author: 'Fixture',
    description: 'Fixture'
  })
  const descriptor: PluginDescriptor = {
    manifest,
    compatible: false,
    enabled: false,
    status: 'incompatible',
    digest: 'a'.repeat(64),
    grants: [],
    trustedDigest: null,
    installedAt: 1,
    diagnostics: [],
    results: [],
    droppedEvents: 0
  }
  api(vi.fn(async () => [descriptor]))
  await flushPromises()
  expect(wrapper!.text()).toContain('Requires API ^2.0.0; this app provides 1.0.0.')
  expect(wrapper!.get('[data-testid="harness-plugin-toggle"]').attributes('disabled')).toBeDefined()
})

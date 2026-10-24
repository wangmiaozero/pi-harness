import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useSessionStore } from '@renderer/stores/sessions'
import { defineComponent } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '@renderer/i18n'
import type { McpInventory, McpScanCandidate } from '@shared/agent-settings/schema'
import McpSettings from './McpSettings.vue'
const mocks = vi.hoisted(() => ({ list: vi.fn(), scan: vi.fn(), save: vi.fn(), toggle: vi.fn() }))
vi.mock('@renderer/composables/useApi', () => ({
  getApi: () => ({ agentSettings: { mcp: mocks } })
}))
const Dialog = defineComponent({
  props: { open: Boolean, title: { type: String, default: '' } },
  template: '<section v-if="open" role="dialog" :aria-label="title"><slot /></section>'
})
const inventory: McpInventory = { path: '/fixture/mcp.json', revision: 'a'.repeat(64), entries: [] }
const candidate: McpScanCandidate = {
  key: 'fixture',
  source: 'Cursor',
  blocked: false,
  warnings: [],
  template: {
    id: 'imported-server',
    type: 'stdio',
    command: 'fixture-server',
    args: ['--read-only'],
    env: { TOKEN: '${TOKEN}' },
    enabled: false,
    exposure: 'codemode'
  }
}
let wrapper: VueWrapper | undefined
beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  i18n.global.locale.value = 'en-US'
  mocks.list.mockResolvedValue(structuredClone(inventory))
  mocks.toggle.mockResolvedValue(structuredClone(inventory))
  mocks.save.mockResolvedValue({ ...inventory, revision: 'b'.repeat(64) })
  mocks.scan.mockResolvedValue({
    candidates: [structuredClone(candidate)],
    sources: [
      { name: 'Cursor', path: '~/.cursor/mcp.json', status: 'read', count: 1 },
      { name: 'Codex', path: '~/.codex/config.toml', status: 'error', count: 0 }
    ]
  })
})
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
})
function button(text: string) {
  const found = wrapper!.findAll('button').find((item) => item.text() === text)
  if (!found) throw new Error(`Button missing: ${text}`)
  return found
}
async function scan() {
  wrapper = mount(McpSettings, {
    global: { plugins: [i18n], stubs: { Dialog, ScopePicker: true } }
  })
  await flushPromises()
  await button('Scan other tools').trigger('click')
  await flushPromises()
}
describe('MCP scan import flow', () => {
  it('previews a discovered server, preserves environment references and saves it disabled', async () => {
    await scan()
    expect(mocks.scan).toHaveBeenCalledWith({})
    expect(wrapper!.text()).toContain('Could not read')
    await button('Review import').trigger('click')
    expect(wrapper!.find('[data-testid="mcp-scan-results"]').exists()).toBe(false)
    const dialog = wrapper!.get('[role="dialog"]')
    expect(dialog.attributes('aria-label')).toBe('Add MCP server')
    expect((dialog.get('input[pattern]').element as HTMLInputElement).value).toBe('imported-server')
    await dialog.get('form').trigger('submit')
    await flushPromises()
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'imported-server',
        revision: inventory.revision,
        enabled: false,
        command: 'fixture-server',
        args: ['--read-only'],
        env: { TOKEN: '${TOKEN}' }
      })
    )
    expect(wrapper!.find('[role="dialog"]').exists()).toBe(false)
    expect(wrapper!.text()).toContain('Changes saved')
  })
  it('requires replacing hidden credential arguments before saving an import', async () => {
    mocks.scan.mockResolvedValue({
      candidates: [
        {
          ...candidate,
          blocked: true,
          warnings: ['credentials'],
          template: { ...candidate.template, args: ['--token', '[redacted]'] }
        }
      ],
      sources: []
    })
    await scan()
    await button('Review import').trigger('click')
    const dialog = wrapper!.get('[role="dialog"]')
    await dialog.get('form').trigger('submit')
    expect(mocks.save).not.toHaveBeenCalled()
    expect(dialog.text()).toContain('Replace redacted arguments')
    const label = dialog.findAll('label').find((item) => item.text().startsWith('Arguments'))!
    await label.get('textarea').setValue('--read-only')
    await dialog.get('form').trigger('submit')
    await flushPromises()
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({ args: ['--read-only'], enabled: false })
    )
  })
  it('keeps global and project revisions separate when editing servers with the same name', async () => {
    const sessions = useSessionStore()
    sessions.items = [
      {
        id: 'selected',
        path: '/fixture/session.jsonl',
        cwd: '/fixture/project',
        projectRoot: '/fixture/project',
        projectKey: '/fixture/project',
        created: '2026-10-24',
        modified: '2026-10-24',
        firstMessage: 'Fixture conversation',
        messageCount: 1
      }
    ]
    sessions.currentId = 'selected'
    const entry = {
      ...candidate.template,
      id: 'shared',
      description: 'Server',
      args: ['--read-only'],
      env: {},
      headers: {},
      url: '',
      protectedFields: false,
      capability: {}
    }
    const global = { ...inventory, entries: [entry] },
      project = {
        path: '/fixture/project/.pi/mcp.json',
        revision: 'c'.repeat(64),
        entries: [entry]
      }
    mocks.list.mockImplementation(async (scope) =>
      scope.root ? structuredClone(project) : structuredClone(global)
    )
    mocks.save.mockResolvedValue(structuredClone(project))
    mocks.toggle.mockResolvedValue(structuredClone(global))
    wrapper = mount(McpSettings, { global: { plugins: [i18n], stubs: { Dialog } } })
    await flushPromises()
    expect(wrapper.get('[data-testid="mcp-scope-global"]').text()).toContain('shared')
    expect(wrapper.get('[data-testid="mcp-scope-project"]').text()).toContain('shared')
    await wrapper
      .get('[data-testid="mcp-scope-project"] button[aria-label="Edit shared"]')
      .trigger('click')
    const dialog = wrapper.get('[role="dialog"]')
    expect(dialog.findAll('select')[0].attributes('disabled')).toBeDefined()
    await dialog.get('form').trigger('submit')
    await flushPromises()
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        root: '/fixture/project',
        id: 'shared',
        revision: project.revision
      })
    )
    await wrapper.get('[data-testid="mcp-scope-global"] button[role="switch"]').trigger('click')
    await flushPromises()
    expect(mocks.toggle).toHaveBeenCalledWith({
      id: 'shared',
      revision: global.revision,
      enabled: true
    })
    const projectTab = wrapper
      .get('[role="group"][aria-label="Scope"]')
      .findAll('button')
      .find((item) => item.text().startsWith('Project'))!
    await projectTab.trigger('click')
    expect(wrapper.find('[data-testid="mcp-scope-global"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="mcp-scope-project"]').exists()).toBe(true)
  })
  it('prevents importing over an existing server with the same name', async () => {
    mocks.list.mockResolvedValue({
      ...inventory,
      entries: [
        { ...candidate.template, capability: {}, description: '', url: '', headers: {}, env: {} }
      ]
    })
    await scan()
    expect(button('Added').attributes('disabled')).toBeDefined()
    expect(wrapper!.text()).toContain('imported-server')
    expect(mocks.save).not.toHaveBeenCalled()
  })
})

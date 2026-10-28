import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { i18n } from '@renderer/i18n'
import ToolCallView from './ToolCallView.vue'
import type { ToolCallContent, ToolResultMessage } from '@shared/types/workspace'

const block: ToolCallContent = {
  type: 'toolCall',
  toolCallId: 'tool-1',
  toolName: 'bash',
  input: { command: 'pnpm typecheck' }
}
const result: ToolResultMessage = {
  role: 'toolResult',
  toolCallId: 'tool-1',
  content: [{ type: 'text', text: 'Types checked' }]
}
const global = { plugins: [i18n], stubs: { BranchNavigator: true, Dialog: true } }

async function setOpen(wrapper: ReturnType<typeof mount>, open: boolean) {
  const details = wrapper.get('details')
  ;(details.element as HTMLDetailsElement).open = open
  await details.trigger('toggle')
}

describe('ToolCallView', () => {
  it('shows a compact activity and only mounts raw details after expansion', async () => {
    const wrapper = mount(ToolCallView, { props: { block, result }, global })
    expect(wrapper.get('summary').text()).toContain('pnpm typecheck')
    expect(wrapper.get('details').attributes('open')).toBeUndefined()
    expect(wrapper.find('pre').exists()).toBe(false)
    await setOpen(wrapper, true)
    expect(wrapper.findAll('pre').map((pre) => pre.text())).toEqual([
      '$ pnpm typecheck',
      'Types checked'
    ])
    await setOpen(wrapper, false)
    expect(wrapper.find('pre').exists()).toBe(false)
  })

  it('keeps the reader’s expansion when a running call receives its result', async () => {
    const wrapper = mount(ToolCallView, { props: { block, running: true }, global })
    await setOpen(wrapper, true)
    await wrapper.setProps({ running: false, result })
    expect((wrapper.get('details').element as HTMLDetailsElement).open).toBe(true)
    expect(wrapper.text()).toContain('Types checked')
    await setOpen(wrapper, false)
    await wrapper.setProps({
      result: { ...result, content: [{ type: 'text', text: 'More output' }] }
    })
    expect(wrapper.find('pre').exists()).toBe(false)
  })

  it('makes failures visible even while the output is collapsed', () => {
    const wrapper = mount(ToolCallView, {
      props: { block, result: { ...result, isError: true } },
      global
    })
    expect(wrapper.get('summary').classes()).toContain('activity-error')
    expect(wrapper.find('pre').exists()).toBe(false)
  })

  it('preserves image results for on-demand preview', async () => {
    const wrapper = mount(ToolCallView, {
      props: {
        block,
        result: { ...result, content: [{ type: 'image', data: 'TQ==', mimeType: 'image/png' }] }
      },
      global
    })
    expect(wrapper.find('img').exists()).toBe(false)
    await setOpen(wrapper, true)
    expect(wrapper.get('img').attributes('src')).toBe('data:image/png;base64,TQ==')
  })
})

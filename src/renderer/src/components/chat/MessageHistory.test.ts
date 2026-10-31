import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { i18n } from '@renderer/i18n'
import MessageHistory from './MessageHistory.vue'
import type { HistoryItem } from './message-activity'

function items(): HistoryItem[] {
  return [
    {
      key: 'call',
      message: {
        role: 'assistant',
        model: 'test',
        provider: 'test',
        content: [
          {
            type: 'toolCall',
            toolCallId: 'bash-1',
            toolName: 'bash',
            input: { command: 'pnpm typecheck' }
          }
        ]
      }
    }
  ]
}
const global = { plugins: [i18n], stubs: { BranchNavigator: true, Dialog: true } }

async function openDetails(element: Element, open: boolean) {
  ;(element as HTMLDetailsElement).open = open
  element.dispatchEvent(new Event('toggle'))
  await flushPromises()
}

describe('MessageHistory activities', () => {
  it('requires two levels of expansion and preserves each level as results arrive', async () => {
    const inputs = items()
    const wrapper = mount(MessageHistory, {
      props: { items: inputs, userName: 'Me', assistantName: 'Pi', running: true },
      global
    })
    const group = wrapper.get('[data-testid="message-activity"]')
    expect(wrapper.find('.tool-call-hud').exists()).toBe(false)
    expect(group.text()).toContain('Running')
    await openDetails(group.element, true)
    const tool = wrapper.get('.tool-call-hud')
    expect(tool.attributes('open')).toBeUndefined()
    expect(wrapper.find('pre').exists()).toBe(false)
    await openDetails(tool.element, true)
    expect(wrapper.get('pre').text()).toBe('$ pnpm typecheck')

    await wrapper.setProps({
      running: false,
      items: [
        ...inputs,
        {
          key: 'result',
          message: {
            role: 'toolResult',
            toolCallId: 'bash-1',
            content: [{ type: 'text', text: 'Checks passed' }]
          }
        }
      ]
    })
    expect((group.element as HTMLDetailsElement).open).toBe(true)
    expect((tool.element as HTMLDetailsElement).open).toBe(true)
    expect(wrapper.text()).toContain('Checks passed')
    expect(wrapper.findAll('.tool-call-hud')).toHaveLength(1)
    await openDetails(group.element, false)
    await openDetails(group.element, true)
    expect((tool.element as HTMLDetailsElement).open).toBe(true)
  })

  it('does not reveal output on settlement, and exposes failures in the closed summary', async () => {
    const inputs = items()
    const wrapper = mount(MessageHistory, {
      props: { items: inputs, userName: 'Me', assistantName: 'Pi', running: true },
      global
    })
    await wrapper.setProps({
      running: false,
      items: [
        ...inputs,
        {
          key: 'result',
          message: {
            role: 'toolResult',
            toolCallId: 'bash-1',
            isError: true,
            content: [{ type: 'text', text: 'Compile failed' }]
          }
        }
      ]
    })
    const group = wrapper.get('[data-testid="message-activity"]')
    expect(group.attributes('open')).toBeUndefined()
    expect(group.get('summary').text()).toContain('Failed steps: 1')
    expect(wrapper.find('pre').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Compile failed')
  })

  it.each(['stop', 'error', 'aborted', 'length'])(
    'separates failed steps from a later %s reply',
    async (stopReason) => {
      const inputs = items()
      const wrapper = mount(MessageHistory, {
        props: {
          items: [
            ...inputs,
            {
              key: 'result',
              message: {
                role: 'toolResult',
                toolCallId: 'bash-1',
                isError: true,
                content: [{ type: 'text', text: 'Command exited with code 1' }]
              }
            },
            {
              key: 'final',
              message: {
                role: 'assistant',
                provider: 'test',
                model: 'test',
                stopReason,
                content: [{ type: 'text', text: 'Finished examining the project.' }]
              }
            }
          ],
          userName: 'Me',
          assistantName: 'Pi'
        },
        global
      })
      const group = wrapper.get('[data-testid="message-activity"]')
      expect(group.attributes('data-outcome')).toBe(
        stopReason === 'stop' ? 'completed-with-errors' : 'error'
      )
      await openDetails(group.element, true)
      expect(wrapper.get('.tool-call-hud').attributes('data-outcome')).toBe('error')
    }
  )
})

it('uses one role label and one copy action for the whole assistant turn, including the live continuation', async () => {
  const inputs: HistoryItem[] = [
    { key: 'user', message: { role: 'user', content: 'Inspect' } },
    {
      key: 'intro',
      message: {
        role: 'assistant',
        model: 'test',
        provider: 'test',
        content: [{ type: 'text', text: 'Checking.' }]
      }
    },
    ...items(),
    {
      key: 'done',
      message: {
        role: 'assistant',
        model: 'test',
        provider: 'test',
        content: [{ type: 'text', text: 'Done.' }]
      }
    }
  ]
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.assign(navigator, { clipboard: { writeText } })
  const wrapper = mount(MessageHistory, {
    props: { items: inputs, userName: 'Me', assistantName: 'Pi' },
    global
  })
  await flushPromises()
  expect(wrapper.findAll('[data-testid="assistant-turn"]')).toHaveLength(1)
  expect(wrapper.findAll('[data-message-role="assistant"] .message-role-badge')).toHaveLength(1)
  expect(wrapper.findAll('[data-testid="copy-assistant-message"]')).toHaveLength(1)
  await wrapper.get('[data-testid="copy-assistant-message"]').trigger('click')
  expect(writeText).toHaveBeenCalledWith('Checking.\n\nDone.')
  await wrapper.setProps({
    running: true,
    liveMessage: {
      role: 'assistant',
      model: 'test',
      provider: 'test',
      content: [{ type: 'text', text: 'More details' }]
    }
  })
  expect(wrapper.findAll('[data-message-role="assistant"] .message-role-badge')).toHaveLength(1)
  expect(wrapper.get('[data-testid="assistant-turn"]').text()).toContain('More details')
})

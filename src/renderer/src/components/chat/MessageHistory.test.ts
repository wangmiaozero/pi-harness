import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, onUpdated, type PropType } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { i18n } from '@renderer/i18n'
import MessageHistory from './MessageHistory.vue'
import type { ConversationItem, HistoryItem } from './message-activity'

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
  it('keeps one collapsed activity row from live thinking through successive command results', async () => {
    const wrapper = mount(MessageHistory, {
      props: { items: [], userName: 'Me', assistantName: 'Pi', running: true },
      global
    })
    const thinking = {
      role: 'assistant' as const,
      model: 'test',
      provider: 'test',
      content: [{ type: 'thinking' as const, thinking: 'Checking commands' }]
    }
    await wrapper.setProps({ liveMessage: thinking })
    const row = wrapper.get('[data-testid="message-activity"]').element
    const history: HistoryItem[] = []
    for (let index = 1; index <= 3; index += 1) {
      const message = {
        ...thinking,
        content: [
          {
            type: 'toolCall' as const,
            toolCallId: `command-${index}`,
            toolName: 'bash',
            input: { command: `echo ${index}` }
          }
        ]
      }
      await wrapper.setProps({ liveMessage: message })
      expect(wrapper.findAll('[data-testid="message-activity"]')).toHaveLength(1)
      expect(wrapper.get('[data-testid="message-activity"]').element).toBe(row)
      expect(wrapper.find('.tool-call-hud').exists()).toBe(false)
      expect(wrapper.find('[data-testid="thinking-details"]').exists()).toBe(false)
      history.push({ key: `saved-${index}`, message })
      await wrapper.setProps({ items: [...history], liveMessage: null })
      history.push({
        key: `result-${index}`,
        message: {
          role: 'toolResult',
          toolCallId: `command-${index}`,
          content: [{ type: 'text', text: 'done' }]
        }
      })
      await wrapper.setProps({ items: [...history] })
      expect(wrapper.get('[data-testid="message-activity"]').element).toBe(row)
      expect((row as HTMLDetailsElement).open).toBe(false)
    }
    expect(wrapper.get('summary').text()).toContain('Ran commands · 3')
    wrapper.unmount()
  })

  it('preserves a live command disclosure when the command is persisted', async () => {
    const message = items()[0].message
    if (message.role !== 'assistant') throw new Error('Expected assistant fixture')
    const wrapper = mount(MessageHistory, {
      props: {
        items: [],
        userName: 'Me',
        assistantName: 'Pi',
        running: true,
        liveMessage: message
      },
      global
    })
    const group = wrapper.get('[data-testid="message-activity"]').element
    await openDetails(group, true)
    const tool = wrapper.get('.tool-call-hud').element
    await openDetails(tool, true)
    await wrapper.setProps({ items: items(), liveMessage: null })
    expect(wrapper.get('[data-testid="message-activity"]').element).toBe(group)
    expect(wrapper.get('.tool-call-hud').element).toBe(tool)
    expect((tool as HTMLDetailsElement).open).toBe(true)
    wrapper.unmount()
  })

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
  expect(wrapper.findAll('[data-testid="assistant-loading"]')).toHaveLength(1)
  await wrapper.setProps({ running: false, liveMessage: null })
  expect(wrapper.find('[data-testid="assistant-loading"]').exists()).toBe(false)
})

it('shows loading before the first token without adding a duplicate assistant turn', async () => {
  const inputs: HistoryItem[] = [
    { key: 'old-user', message: { role: 'user', content: 'Previous question' } },
    {
      key: 'old-reply',
      message: {
        role: 'assistant',
        model: 'test',
        provider: 'test',
        content: [{ type: 'text', text: 'Previous reply' }]
      }
    },
    { key: 'user', message: { role: 'user', content: 'Next question' } }
  ]
  const wrapper = mount(MessageHistory, {
    props: { items: inputs, userName: 'Me', assistantName: 'Pi' },
    global
  })
  expect(wrapper.find('[data-testid="assistant-loading"]').exists()).toBe(false)
  await wrapper.setProps({ running: true })
  expect(wrapper.findAll('[data-testid="assistant-turn"]')).toHaveLength(2)
  expect(wrapper.findAll('[data-testid="assistant-loading"]')).toHaveLength(1)
  expect(wrapper.get('[role="status"]').text()).toContain('Pi')
  const reply = {
    role: 'assistant' as const,
    model: 'test',
    provider: 'test',
    content: [{ type: 'text' as const, text: 'First token' }]
  }
  await wrapper.setProps({ liveMessage: reply })
  expect(wrapper.findAll('[data-testid="assistant-turn"]')).toHaveLength(2)
  expect(wrapper.text()).toContain('First token')
  await wrapper.setProps({
    items: [...inputs, { key: 'reply', message: reply }],
    running: false,
    liveMessage: null
  })
  expect(wrapper.find('[data-testid="assistant-loading"]').exists()).toBe(false)
  expect(wrapper.findAll('[data-testid="assistant-turn"]')).toHaveLength(2)
  wrapper.unmount()
})

it('clears an empty waiting turn when submission is cancelled or fails', async () => {
  const wrapper = mount(MessageHistory, {
    props: { items: [], userName: 'Me', assistantName: 'Pi', running: true },
    global
  })
  expect(wrapper.find('[data-testid="assistant-loading"]').exists()).toBe(true)
  await wrapper.setProps({ running: false })
  expect(wrapper.find('[data-testid="assistant-turn"]').exists()).toBe(false)
  wrapper.unmount()
})

it('isolates completed turns from token updates while updating participant names', async () => {
  const updates = new Map<string, number>()
  const history: HistoryItem[] = [
    { key: 'user-1', message: { role: 'user', content: 'First question' } },
    {
      key: 'answer-1',
      message: {
        role: 'assistant',
        model: 'fixture',
        provider: 'fixture',
        content: [{ type: 'text', text: 'First reply' }]
      }
    },
    { key: 'user-2', message: { role: 'user', content: 'Continue' } }
  ]
  const wrapper = mount(MessageHistory, {
    props: { items: history, userName: 'Me', assistantName: 'Pi', running: true },
    global: {
      plugins: [i18n],
      stubs: {
        HistoryTurn: defineComponent({
          inheritAttrs: false,
          props: {
            turn: { type: Object as PropType<ConversationItem>, required: true },
            assistantName: { type: String, required: true }
          },
          setup(props) {
            onUpdated(() => updates.set(props.turn.key, (updates.get(props.turn.key) ?? 0) + 1))
            return () => h('p', props.turn.key + props.assistantName)
          }
        })
      }
    }
  })
  for (const text of ['a', 'ab', 'abc']) {
    await wrapper.setProps({
      liveMessage: {
        role: 'assistant',
        model: 'fixture',
        provider: 'fixture',
        content: [{ type: 'text', text }]
      }
    })
  }
  expect(updates.get('turn:user-1') ?? 0).toBe(0)
  expect(updates.get('turn:user-2')).toBeGreaterThan(0)
  await wrapper.setProps({ assistantName: 'Other' })
  expect(updates.get('turn:user-1')).toBe(1)
  wrapper.unmount()
})

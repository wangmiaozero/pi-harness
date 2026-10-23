import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type { AgentMessage } from '@shared/types/workspace'
import { i18n } from '@renderer/i18n'
import {
  CONVERSATION_MINIMAP_PREVIEW_MAX_CHARS,
  buildConversationMinimapMarkers,
  messageTextContent,
  shouldRenderConversationMinimap,
  type MinimapMessage
} from './conversation-minimap'
import ConversationMinimap from './ConversationMinimap.vue'

function entry(key: string, message: AgentMessage): MinimapMessage {
  return { key, message }
}

function user(key: string, content: unknown): MinimapMessage {
  return entry(key, { role: 'user', content } as AgentMessage)
}

function assistant(key: string, text: string): MinimapMessage {
  return entry(key, {
    role: 'assistant',
    content: text ? [{ type: 'text', text }] : [],
    model: 'model',
    provider: 'provider'
  } as AgentMessage)
}

function toolResult(key: string): MinimapMessage {
  return entry(key, {
    role: 'toolResult',
    content: [{ type: 'text', text: 'tool output' }],
    toolCallId: 'call-1',
    toolName: 'read'
  } as AgentMessage)
}

describe('conversation minimap markers', () => {
  it('renders the rail only for overflowing transcripts with at least two turns', () => {
    expect(
      shouldRenderConversationMinimap({ markerCount: 1, overflows: true })
    ).toBe(false)
    expect(
      shouldRenderConversationMinimap({ markerCount: 3, overflows: false })
    ).toBe(false)
    expect(
      shouldRenderConversationMinimap({ markerCount: 2, overflows: true })
    ).toBe(true)
  })

  it('extracts plain text from strings and text blocks only', () => {
    expect(
      messageTextContent({
        role: 'user',
        content: [
          { type: 'image', data: 'img', mimeType: 'image/png' },
          { type: 'text', text: ' look at this ' }
        ]
      } as AgentMessage)
    ).toBe('look at this')
    expect(
      messageTextContent({
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'hidden reasoning' },
          { type: 'text', text: 'answer' },
          { type: 'toolCall', toolCallId: 'c', toolName: 'read', input: {} }
        ]
      } as AgentMessage)
    ).toBe('answer')
    expect(messageTextContent({ role: 'user', content: '  hi  ' } as AgentMessage)).toBe('hi')
    expect(messageTextContent({ role: 'user', content: [] } as AgentMessage)).toBe('')
  })

  it('builds one marker per user turn and one per assistant turn', () => {
    const markers = buildConversationMinimapMarkers([
      user('u1', 'first question'),
      toolResult('t1'),
      assistant('a1', 'first answer'),
      assistant('a2', ' continued'),
      user('u2', 'second question'),
      assistant('a3', 'second answer')
    ])

    expect(markers.map((marker) => marker.id)).toEqual(['u1', 'a1', 'u2', 'a3'])
    expect(markers.map((marker) => marker.role)).toEqual([
      'user',
      'assistant',
      'user',
      'assistant'
    ])
    expect(markers[1].preview).toBe('first answer\n\ncontinued')
  })

  it('skips assistant turns without text and caps previews', () => {
    const long = 'x'.repeat(CONVERSATION_MINIMAP_PREVIEW_MAX_CHARS + 40)
    const markers = buildConversationMinimapMarkers([
      user('u1', 'question'),
      assistant('t1', ''),
      assistant('a1', long),
      assistant('a2', ' never appended')
    ])

    expect(markers.map((marker) => marker.id)).toEqual(['u1', 'a1'])
    expect(markers[1].preview).toHaveLength(CONVERSATION_MINIMAP_PREVIEW_MAX_CHARS)
    expect(markers[1].preview.endsWith(' never appended')).toBe(false)
  })

  it('returns empty markers for tool-only transcripts', () => {
    expect(buildConversationMinimapMarkers([toolResult('t1'), toolResult('t2')])).toEqual([])
  })
})

describe('ConversationMinimap component', () => {
  function stubScroller(): HTMLElement {
    const el = document.createElement('div')
    const content = document.createElement('div')
    for (const id of ['u1', 'a1']) {
      const row = document.createElement('article')
      row.dataset.minimapId = id
      content.appendChild(row)
    }
    el.appendChild(content)
    Object.defineProperty(el, 'scrollHeight', { value: 800, configurable: true })
    Object.defineProperty(el, 'clientHeight', { value: 300, configurable: true })
    el.scrollTo = () => undefined
    return el
  }

  function mountMinimap(target: HTMLElement) {
    return mount(ConversationMinimap, {
      props: {
        target,
        messages: [user('u1', 'hello there'), assistant('a1', 'hi, ready to help')]
      },
      global: { plugins: [i18n] }
    })
  }

  it('renders dashes for overflowing transcripts and previews on hover', async () => {
    const wrapper = mountMinimap(stubScroller())
    const rail = wrapper.get('[data-testid="minimap-rail"]')
    expect(rail.findAll('.minimap-marker')).toHaveLength(2)
    expect(rail.findAll('.minimap-marker.user')).toHaveLength(1)
    expect(rail.findAll('.minimap-marker.assistant')).toHaveLength(1)

    await rail.trigger('mousemove', { clientY: 8 })
    await new Promise((resolve) => setTimeout(resolve, 20))
    const popover = wrapper.get('.minimap-popover')
    expect(popover.text()).toContain(i18n.global.t('workspace.minimapUserMessage'))
    expect(popover.text()).toContain('hello there')
  })

  it('jumps to a turn and asks the transcript to release follow mode', async () => {
    const target = stubScroller()
    const scrollTo = vi.spyOn(target, 'scrollTo')
    const wrapper = mountMinimap(target)

    await wrapper.get('button.minimap-marker.user').trigger('click')
    expect(wrapper.emitted('releaseFollow')).toHaveLength(1)
    expect(scrollTo).toHaveBeenCalledWith({ top: expect.any(Number), behavior: 'smooth' })
  })

  it('stays hidden when the transcript does not overflow', async () => {
    const target = stubScroller()
    Object.defineProperty(target, 'scrollHeight', { value: 300, configurable: true })
    Object.defineProperty(target, 'clientHeight', { value: 800, configurable: true })
    const wrapper = mountMinimap(target)
    expect(wrapper.find('[data-testid="minimap-rail"]').exists()).toBe(false)
  })
})

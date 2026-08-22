import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MessageView from './MessageView.vue'
import type { AssistantMessage, ToolResultMessage } from '@shared/types/workspace'

describe('MessageView', () => {
  it('renders assistant text as safe Markdown', async () => {
    const message: AssistantMessage = {
      role: 'assistant',
      model: 'test-model',
      provider: 'test-provider',
      content: [
        {
          type: 'text',
          text: [
            '## 核心能力',
            '',
            '**读取代码**并分析。',
            '',
            '- 第一项',
            '- 第二项',
            '',
            '- [x] 已完成',
            '',
            '```ts',
            'const answer = 42',
            '```',
            '',
            '<script>alert("unsafe")</script>'
          ].join('\n')
        }
      ]
    }

    const wrapper = mount(MessageView, {
      props: { message },
      global: {
        mocks: { $t: (key: string) => key },
        stubs: {
          BranchNavigator: true,
          Dialog: true,
          ToolCallView: true
        }
      }
    })
    await flushPromises()

    expect(wrapper.get('h2').text()).toBe('核心能力')
    expect(wrapper.get('strong').text()).toBe('读取代码')
    expect(wrapper.findAll('li').map((item) => item.text())).toEqual(['第一项', '第二项', '已完成'])
    expect(wrapper.get('pre code').text()).toBe('const answer = 42')
    expect(wrapper.get('input[type="checkbox"]').attributes()).toMatchObject({
      checked: '',
      disabled: ''
    })
    expect(wrapper.find('script').exists()).toBe(false)
  })

  it('collapses tool results by default and allows expanding them', async () => {
    const message: ToolResultMessage = {
      role: 'toolResult',
      toolCallId: 'tool-1',
      toolName: 'write',
      content: [{ type: 'text', text: '<html>generated output</html>' }]
    }

    const wrapper = mount(MessageView, {
      props: { message },
      global: {
        mocks: { $t: (key: string) => (key === 'workspace.roleTool' ? '工具' : key) },
        stubs: {
          BranchNavigator: true,
          Dialog: true
        }
      }
    })

    const details = wrapper.get('[data-testid="tool-result-details"]')
    expect(details.attributes('open')).toBeUndefined()
    expect(details.get('summary').text()).toBe('工具')
    expect(details.get('pre').text()).toBe('<html>generated output</html>')

    await details.get('summary').trigger('click')
    expect((details.element as HTMLDetailsElement).open).toBe(true)
  })
})

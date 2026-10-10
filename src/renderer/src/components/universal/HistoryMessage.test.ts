import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import type { UniversalMessage } from '@shared/universal/schema'
import { universalMessages } from '../../i18n/universal'
import HistoryMessage from './HistoryMessage.vue'

describe('read-only history rendering', () => {
  it('localizes message controls, leaves unknown tokens unknown and renders external content passively', () => {
    const message: UniversalMessage = {
      id: 'message',
      sessionId: 'a'.repeat(64),
      role: 'assistant',
      sourceRef: '/source#record=1',
      parts: [
        { type: 'usage', cost: 0.01 },
        { type: 'thinking', text: '分析' },
        {
          type: 'text',
          text: '<img src="https://example.invalid/secret"><script>alert(1)</script>'
        },
        { type: 'image-reference', reference: 'https://example.invalid/image' },
        { type: 'usage', input: 2, output: 3, cached: 10, cacheWrite: 4 }
      ]
    }
    const wrapper = mount(HistoryMessage, {
      props: { message },
      global: {
        plugins: [
          createI18n({
            legacy: false,
            locale: 'zh-CN',
            messages: { 'zh-CN': { universal: universalMessages['zh-CN'] } }
          })
        ]
      }
    })
    expect(wrapper.text()).toContain('助手')
    expect(wrapper.text()).toContain('思考 / 推理')
    expect(wrapper.text()).toContain('暂无 Token 数据')
    expect(wrapper.text()).toContain('记录的 Token · 19')
    expect(wrapper.findAll('img, script, a')).toHaveLength(0)
  })
})

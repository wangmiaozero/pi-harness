import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import StreamingMarkdown from './StreamingMarkdown.vue'

const { parseCalls } = vi.hoisted(() => ({ parseCalls: [] as string[] }))

vi.mock('@comark/vue', () => ({
  Markdown: {
    name: 'MarkdownStub',
    props: ['value', 'streaming', 'options', 'plugins'],
    setup(props: { value: string }) {
      return () => {
        parseCalls.push(props.value)
        return null
      }
    }
  }
}))

describe('StreamingMarkdown', () => {
  beforeEach(() => {
    parseCalls.length = 0
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('passes values straight through when not streaming', async () => {
    const wrapper = mount(StreamingMarkdown, {
      props: { value: 'hello', streaming: false, intervalMs: 64 }
    })
    expect(parseCalls).toEqual(['hello'])

    await wrapper.setProps({ value: 'hello world' })
    expect(parseCalls).toEqual(['hello', 'hello world'])
  })

  it('coalesces rapid streaming updates into one re-parse per interval', async () => {
    const wrapper = mount(StreamingMarkdown, {
      props: { value: '', streaming: true, intervalMs: 64 }
    })

    await wrapper.setProps({ value: 'a' })
    await wrapper.setProps({ value: 'ab' })
    await wrapper.setProps({ value: 'abc' })
    expect(parseCalls).toEqual([''])

    await vi.advanceTimersByTimeAsync(64)
    expect(parseCalls).toEqual(['', 'abc'])

    await wrapper.setProps({ value: 'abcd' })
    await vi.advanceTimersByTimeAsync(64)
    expect(parseCalls).toEqual(['', 'abc', 'abcd'])
  })

  it('flushes the final value immediately when streaming ends', async () => {
    const wrapper = mount(StreamingMarkdown, {
      props: { value: '', streaming: true, intervalMs: 64 }
    })

    await wrapper.setProps({ value: 'partial' })
    expect(parseCalls).toEqual([''])

    await wrapper.setProps({ value: 'final text', streaming: false })
    expect(parseCalls).toEqual(['', 'final text'])

    await vi.advanceTimersByTimeAsync(500)
    expect(parseCalls).toEqual(['', 'final text'])
  })

  it('renders the latest text after the flush interval, not a stale snapshot', async () => {
    const wrapper = mount(StreamingMarkdown, {
      props: { value: '', streaming: true, intervalMs: 64 }
    })

    await wrapper.setProps({ value: 'first' })
    await vi.advanceTimersByTimeAsync(63)
    await wrapper.setProps({ value: 'first-second' })
    await vi.advanceTimersByTimeAsync(1)

    expect(parseCalls).toEqual(['', 'first-second'])
  })
})

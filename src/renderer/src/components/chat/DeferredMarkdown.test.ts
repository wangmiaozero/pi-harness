import { mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import DeferredMarkdown from './DeferredMarkdown.vue'
afterEach(() => vi.unstubAllGlobals())
it('retains searchable text while deferring parsing until near the viewport and disconnects', async () => {
  let notify!: IntersectionObserverCallback
  const disconnect = vi.fn()
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        notify = callback
      }
      observe = vi.fn()
      disconnect = disconnect
    }
  )
  const wrapper = mount(DeferredMarkdown, {
    props: { value: '**Searchable history**' },
    global: {
      stubs: { StreamingMarkdown: { props: ['value'], template: '<strong>{{value}}</strong>' } }
    }
  })
  expect(wrapper.text()).toContain('Searchable history')
  expect(wrapper.find('strong').exists()).toBe(false)
  notify([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver)
  await wrapper.vm.$nextTick()
  expect(wrapper.find('strong').exists()).toBe(true)
  expect(disconnect).toHaveBeenCalledOnce()
  wrapper.unmount()
})
it('renders a streaming message immediately even before visibility is reported', () => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe = vi.fn()
      disconnect = vi.fn()
    }
  )
  const wrapper = mount(DeferredMarkdown, {
    props: { value: 'live', streaming: true },
    global: { stubs: { StreamingMarkdown: { template: '<strong>live</strong>' } } }
  })
  expect(wrapper.find('strong').exists()).toBe(true)
  wrapper.unmount()
})

it('retains offscreen headings and keyboard links with the existing security policy', async () => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe = vi.fn()
      disconnect = vi.fn()
    }
  )
  const { default: security } = await import('@comark/vue/plugins/security')
  const wrapper = mount(DeferredMarkdown, {
    props: {
      value:
        '# Offscreen heading\n\n[Safe link](https://example.com)\n\n[Blocked link](javascript:alert(1))\n\n<script>alert(1)</script>',
      options: { registerDefaultPlugins: false },
      plugins: [
        security({
          allowedTags: ['h1', 'p', 'a'],
          allowedProtocols: ['https'],
          allowDataImages: false
        })
      ]
    }
  })
  await vi.waitFor(() => expect(wrapper.find('h1').text()).toBe('Offscreen heading'))
  expect(wrapper.find('a[href="https://example.com"]').text()).toBe('Safe link')
  expect(wrapper.find('script').exists()).toBe(false)
  expect(wrapper.find('a[href^="javascript:"]').exists()).toBe(false)
  wrapper.unmount()
})

it('restores semantic formatting when an offscreen stream finishes', async () => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe = vi.fn()
      disconnect = vi.fn()
    }
  )
  const wrapper = mount(DeferredMarkdown, {
    props: { value: '# Finished heading', streaming: true },
    global: { stubs: { StreamingMarkdown: { template: '<strong>live</strong>' } } }
  })
  await wrapper.setProps({ streaming: false })
  await vi.waitFor(() => expect(wrapper.find('h1').text()).toBe('Finished heading'))
  wrapper.unmount()
})

it('keeps static history images lazy while using the shared security policy', async () => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe = vi.fn()
      disconnect = vi.fn()
    }
  )
  const wrapper = mount(DeferredMarkdown, {
    props: { value: '![Fixture](https://example.invalid/picture.png)' }
  })
  await vi.waitFor(() => expect(wrapper.find('img').attributes('loading')).toBe('lazy'))
  wrapper.unmount()
})

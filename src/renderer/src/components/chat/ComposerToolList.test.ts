import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createI18n } from 'vue-i18n'
import { messages } from '@renderer/i18n'
import ComposerToolList from './ComposerToolList.vue'

const wrappers: VueWrapper[] = []

function mountToolList(refresh: () => Promise<boolean>) {
  const wrapper = mount(ComposerToolList, {
    props: {
      tools: [],
      saved: [],
      loading: false,
      ready: true,
      applying: false,
      busy: false,
      error: null,
      refresh
    },
    global: { plugins: [createI18n({ legacy: false, locale: 'zh-CN', messages })] }
  })
  wrappers.push(wrapper)
  return wrapper
}

afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
})

describe('ComposerToolList refresh feedback', () => {
  it('shows progress and acknowledges success even when the list stays empty', async () => {
    let complete!: (refreshed: boolean) => void
    const refresh = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          complete = resolve
        })
    )
    const wrapper = mountToolList(refresh)

    await wrapper
      .findAll('button')
      .find((button) => button.text() === '从 Pi 刷新')!
      .trigger('click')
    const button = wrapper.get('button[aria-busy="true"]')
    expect(button.text()).toBe('正在刷新…')
    expect(button.get('svg').classes()).toContain('motion-safe:animate-spin')
    await button.trigger('click')
    expect(refresh).toHaveBeenCalledTimes(1)

    complete(true)
    await flushPromises()
    expect(button.text()).toBe('已刷新')
    expect(button.attributes('aria-busy')).toBeUndefined()
  })

  it('offers a retry when the refresh fails', async () => {
    const refresh = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const wrapper = mountToolList(refresh)
    const button = wrapper.findAll('button').find((button) => button.text() === '从 Pi 刷新')!

    await button.trigger('click')
    await flushPromises()
    expect(button.text()).toBe('重试刷新')
    expect(button.attributes('aria-disabled')).toBeUndefined()

    await button.trigger('click')
    await flushPromises()
    expect(button.text()).toBe('已刷新')
    expect(refresh).toHaveBeenCalledTimes(2)
  })
})

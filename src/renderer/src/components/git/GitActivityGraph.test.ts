import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { i18n } from '@renderer/i18n'
import GitActivityGraph from './GitActivityGraph.vue'

const wrappers: VueWrapper[] = []
const originalLocale = i18n.global.locale.value

afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  i18n.global.locale.value = originalLocale
})

function mountGraph(locale: 'en-US' | 'zh-CN') {
  i18n.global.locale.value = locale
  const wrapper = mount(GitActivityGraph, {
    props: {
      days: [
        { date: '2026-09-01', commits: 4 },
        { date: '2026-09-19', commits: 2 }
      ]
    },
    global: { plugins: [i18n] }
  })
  wrappers.push(wrapper)
  return wrapper
}

describe('GitActivityGraph', () => {
  it('uses Chinese weekday and week labels when the app locale is zh-CN', () => {
    const wrapper = mountGraph('zh-CN')
    const text = wrapper.text()
    expect(text).toContain('一')
    expect(text).toContain('三')
    expect(text).toContain('五')
    expect(text).not.toContain('Mon')
    expect(text).toContain('周')
    expect(text).not.toMatch(/\d+w\b/)
  })

  it('keeps English weekday and week labels for en-US', () => {
    const wrapper = mountGraph('en-US')
    const text = wrapper.text()
    expect(text).toContain('Mon')
    expect(text).toContain('Wed')
    expect(text).toContain('Fri')
    expect(text).toMatch(/\d+ · \d+w/)
  })

  it('can hide the compact footer and show month labels', () => {
    i18n.global.locale.value = 'en-US'
    const wrapper = mount(GitActivityGraph, {
      props: {
        days: [
          { date: '2026-09-01', commits: 4 },
          { date: '2026-09-19', commits: 2 }
        ],
        showMonths: true,
        hideSummary: true
      },
      global: { plugins: [i18n] }
    })
    wrappers.push(wrapper)
    expect(wrapper.text()).not.toMatch(/\d+ · \d+w/)
    expect(wrapper.text()).toMatch(/Sep|Oct|Nov|Dec|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug/)
  })
})

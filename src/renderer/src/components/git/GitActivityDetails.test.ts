import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { i18n } from '@renderer/i18n'
import GitActivityDetails from './GitActivityDetails.vue'

const wrappers: VueWrapper[] = []

afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
})

describe('GitActivityDetails', () => {
  it('shows totals, the enlarged heatmap, and the weekly chart host', () => {
    const wrapper = mount(GitActivityDetails, {
      props: {
        days: [
          {
            date: '2026-09-01',
            commits: 4,
            authors: [{ name: 'wangmiao', email: 'tuziling84@gmail.com', commits: 4 }]
          },
          { date: '2026-09-02', commits: 0, authors: [] },
          {
            date: '2026-09-03',
            commits: 2,
            authors: [{ name: 'Ada', email: 'ada@example.com', commits: 2 }]
          }
        ]
      },
      global: { plugins: [i18n] }
    })
    wrappers.push(wrapper)

    const text = wrapper.get('[data-testid="git-activity-details"]').text()
    expect(text).toContain(String(i18n.global.t('workspace.gitActivityTotal')))
    expect(text).toContain('6')
    expect(text).toContain('2')
    expect(wrapper.find('[data-testid="git-activity-graph"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="git-activity-weekly-chart"]').exists()).toBe(true)
    const authors = wrapper.get('[data-testid="git-activity-authors"]').text()
    expect(authors).toContain('wangmiao')
    expect(authors).toContain('tuziling84@gmail.com')
    expect(authors).toContain('Ada')
  })
})

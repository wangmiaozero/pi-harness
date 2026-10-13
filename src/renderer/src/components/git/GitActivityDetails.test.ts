import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { i18n } from '@renderer/i18n'
import GitActivityDetails from './GitActivityDetails.vue'
import { echarts, observeThemeChanges } from '@renderer/utils/echarts'

vi.mock('@renderer/utils/echarts', () => ({
  echarts: { init: vi.fn(() => ({ setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() })) },
  chartTooltip: () => ({}),
  resolveThemeColor: (_name: string, fallback: string) => fallback,
  observeThemeChanges: vi.fn(() => vi.fn())
}))

const wrappers: VueWrapper[] = []

afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  vi.clearAllMocks()
})

describe('GitActivityDetails', () => {
  it('does not attach charts or listeners after unmount during lazy loading', async () => {
    const wrapper = mount(GitActivityDetails, { props: { days: [] }, global: { plugins: [i18n] } })
    wrapper.unmount()
    await flushPromises()
    expect(echarts.init).not.toHaveBeenCalled()
    expect(observeThemeChanges).not.toHaveBeenCalled()
  })
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

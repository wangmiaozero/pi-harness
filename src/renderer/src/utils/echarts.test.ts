import { afterEach, describe, expect, it } from 'vitest'
import { chartTooltip } from './echarts'

afterEach(() => {
  document.documentElement.style.removeProperty('--text-primary')
  document.documentElement.style.removeProperty('--bg-surface-raised')
  document.documentElement.style.removeProperty('--border-default')
})

describe('chartTooltip', () => {
  it('uses raised-surface colors so tooltip copy is not white-on-white', () => {
    document.documentElement.style.setProperty('--text-primary', 'rgba(255, 255, 255, 0.9)')
    document.documentElement.style.setProperty('--bg-surface-raised', '#25282e')
    document.documentElement.style.setProperty('--border-default', 'rgba(255, 255, 255, 0.075)')

    const tooltip = chartTooltip()
    expect(tooltip.backgroundColor).toBe('#25282e')
    expect(tooltip.textStyle.color).toBe('rgba(255, 255, 255, 0.9)')
    expect(tooltip.backgroundColor).not.toBe('#ffffff')
    expect(tooltip.extraCssText).toContain('color:rgba(255, 255, 255, 0.9)')
  })
})

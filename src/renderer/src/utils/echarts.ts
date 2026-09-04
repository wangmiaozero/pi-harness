/**
 * On-demand ECharts entry.
 *
 * Never import from the root `echarts` package in the renderer: it bundles
 * every chart, component, and renderer. Register only what the UI actually
 * uses here, so tree-shaking keeps the produced chunk small.
 */
import * as echarts from 'echarts/core'
import {
  GaugeChart,
  BarChart,
  PieChart,
  type GaugeSeriesOption,
  type BarSeriesOption,
  type PieSeriesOption
} from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  type GridComponentOption
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([
  GaugeChart,
  BarChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  CanvasRenderer
])

export type HarnessGaugeOption = echarts.ComposeOption<GaugeSeriesOption>
export type HarnessBarOption = echarts.ComposeOption<BarSeriesOption | GridComponentOption>
export type HarnessPieOption = echarts.ComposeOption<PieSeriesOption>
export type { EChartsType } from 'echarts/core'
export { echarts }

/**
 * ECharts draws to canvas and cannot resolve CSS custom properties, so theme
 * colors must be resolved to concrete values before rendering.
 */
export function resolveThemeColor(variable: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim()
  return value || fallback
}

/**
 * Re-run the callback whenever the app theme changes (data-theme / class /
 * inline style on <html>), so canvas charts follow the active theme.
 */
export function observeThemeChanges(callback: () => void): () => void {
  const observer = new MutationObserver(callback)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'data-theme', 'style']
  })
  return () => observer.disconnect()
}

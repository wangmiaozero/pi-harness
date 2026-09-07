<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { EChartsType } from '@renderer/utils/echarts'

const props = withDefaults(
  defineProps<{
    percent?: number | null
    running?: boolean
  }>(),
  { percent: null, running: false }
)

const host = ref<HTMLElement | null>(null)
let chart: EChartsType | null = null
let stopThemeObserver: (() => void) | null = null
type EchartsModule = typeof import('@renderer/utils/echarts')
let echartsModule: EchartsModule | null = null

function gaugeColor(): string {
  if (!echartsModule) return '#5b8def'
  const percent = props.percent ?? 0
  if (percent >= 85) return echartsModule.resolveThemeColor('--danger', '#d05656')
  if (percent >= 70) return echartsModule.resolveThemeColor('--warning', '#d09b45')
  if (props.running) return echartsModule.resolveThemeColor('--success', '#3aa76d')
  return echartsModule.resolveThemeColor('--accent', '#5b8def')
}

function render(): void {
  if (!chart || !echartsModule) return
  chart.setOption({
    series: [
      {
        type: 'gauge',
        startAngle: 90,
        endAngle: -270,
        radius: '94%',
        center: ['50%', '50%'],
        silent: true,
        pointer: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        anchor: { show: false },
        progress: {
          show: true,
          width: 5,
          roundCap: true,
          itemStyle: { color: gaugeColor() }
        },
        axisLine: {
          roundCap: true,
          lineStyle: {
            width: 5,
            color: [[1, echartsModule.resolveThemeColor('--bg-hover', 'rgba(127,127,127,0.25)')]]
          }
        },
        detail: {
          show: true,
          offsetCenter: [0, 0],
          fontSize: 10,
          fontWeight: 600,
          color: echartsModule.resolveThemeColor('--text-primary', '#333'),
          formatter: () => (props.percent === null ? '—' : `${Math.round(props.percent)}%`)
        },
        data: [{ value: Math.max(0, Math.min(100, props.percent ?? 0)) }]
      }
    ]
  })
}

onMounted(async () => {
  if (!host.value) return
  // Lazy-load the on-demand ECharts bundle so it stays out of the startup chunks.
  echartsModule = await import('@renderer/utils/echarts')
  if (!host.value || chart) return
  chart = echartsModule.echarts.init(host.value)
  render()
  stopThemeObserver = echartsModule.observeThemeChanges(render)
})

onBeforeUnmount(() => {
  stopThemeObserver?.()
  chart?.dispose()
  chart = null
})
</script>

<template>
  <div
    ref="host"
    class="size-12 shrink-0"
    role="img"
    :aria-label="percent === null ? '—' : `${Math.round(percent)}%`"
  />
</template>

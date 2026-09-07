<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { HarnessStats } from '@shared/types/harness'
import type { EChartsType } from '@renderer/utils/echarts'

const props = defineProps<{ stats: HarnessStats | null }>()
const { t } = useI18n()

const tokensHost = ref<HTMLElement | null>(null)
const activityHost = ref<HTMLElement | null>(null)
let tokensChart: EChartsType | null = null
let activityChart: EChartsType | null = null
let stopThemeObserver: (() => void) | null = null
let echartsModule: typeof import('@renderer/utils/echarts') | null = null

const tokenData = computed(() => {
  const tokens = props.stats?.tokens
  if (!tokens) return []
  return [
    { name: t('workspace.tokenInput'), value: tokens.input, color: '--accent' },
    { name: t('workspace.tokenOutput'), value: tokens.output, color: '--success' },
    { name: t('workspace.cacheRead'), value: tokens.cacheRead, color: '--warning' },
    { name: t('workspace.harnessCacheWrite'), value: tokens.cacheWrite, color: '#7c6ee6' }
  ].filter((item) => item.value > 0)
})

const activityData = computed(() => {
  const stats = props.stats
  if (!stats) return []
  return [
    { label: t('workspace.messageUser'), value: stats.userMessages ?? 0 },
    { label: t('workspace.messageAssistant'), value: stats.assistantMessages ?? 0 },
    { label: t('workspace.toolCalls'), value: stats.toolCalls ?? 0 },
    { label: t('workspace.toolResults'), value: stats.toolResults ?? 0 }
  ]
})

function axisColor(): string {
  return echartsModule?.resolveThemeColor('--text-tertiary', '#888') ?? '#888'
}

function splitLineColor(): string {
  return (
    echartsModule?.resolveThemeColor('--border-subtle', 'rgba(127,127,127,0.2)') ??
    'rgba(127,127,127,0.2)'
  )
}

function tooltipText(): string {
  return echartsModule?.resolveThemeColor('--text-primary', '#333') ?? '#333'
}

function renderTokens(): void {
  if (!tokensChart || !echartsModule) return
  if (!tokenData.value.length) {
    tokensChart.clear()
    return
  }
  tokensChart.setOption({
    tooltip: {
      trigger: 'item',
      textStyle: { color: tooltipText(), fontSize: 11 },
      valueFormatter: (value: unknown) => Number(value).toLocaleString()
    },
    legend: {
      bottom: 0,
      icon: 'circle',
      itemWidth: 8,
      itemHeight: 8,
      textStyle: { color: axisColor(), fontSize: 10 }
    },
    series: [
      {
        type: 'pie',
        radius: ['46%', '72%'],
        center: ['50%', '44%'],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: 'transparent', borderWidth: 2 },
        label: { show: false },
        data: tokenData.value.map((item) => ({
          name: item.name,
          value: item.value,
          itemStyle: { color: echartsModule!.resolveThemeColor(item.color, '#5b8def') }
        }))
      }
    ]
  })
}

function renderActivity(): void {
  if (!activityChart || !echartsModule) return
  activityChart.setOption({
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      textStyle: { color: tooltipText(), fontSize: 11 },
      valueFormatter: (value: unknown) => Number(value).toLocaleString()
    },
    grid: { left: 8, right: 8, top: 16, bottom: 4, containLabel: true },
    xAxis: {
      type: 'category',
      data: activityData.value.map((item) => item.label),
      axisLabel: { color: axisColor(), fontSize: 10, interval: 0, rotate: 24 },
      axisLine: { lineStyle: { color: splitLineColor() } },
      axisTick: { show: false }
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: axisColor(), fontSize: 10 },
      splitLine: { lineStyle: { color: splitLineColor() } }
    },
    series: [
      {
        type: 'bar',
        barMaxWidth: 22,
        itemStyle: {
          borderRadius: [3, 3, 0, 0],
          color: echartsModule.resolveThemeColor('--accent', '#5b8def')
        },
        data: activityData.value.map((item) => item.value)
      }
    ]
  })
}

function renderAll(): void {
  renderTokens()
  renderActivity()
}

function onResize(): void {
  tokensChart?.resize()
  activityChart?.resize()
}

onMounted(async () => {
  // Lazy-load the on-demand ECharts bundle so it stays out of the startup chunks.
  echartsModule = await import('@renderer/utils/echarts')
  if (tokensHost.value && !tokensChart) tokensChart = echartsModule.echarts.init(tokensHost.value)
  if (activityHost.value && !activityChart)
    activityChart = echartsModule.echarts.init(activityHost.value)
  renderAll()
  stopThemeObserver = echartsModule.observeThemeChanges(renderAll)
  window.addEventListener('resize', onResize)
})

watch(
  () => props.stats,
  () => renderAll()
)

onBeforeUnmount(() => {
  stopThemeObserver?.()
  window.removeEventListener('resize', onResize)
  tokensChart?.dispose()
  activityChart?.dispose()
  tokensChart = null
  activityChart = null
})
</script>

<template>
  <section class="harness-card max-w-4xl">
    <h3 class="harness-card-title">{{ $t('workspace.harnessStats') }}</h3>
    <template v-if="stats">
      <div class="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div
          class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3"
          data-testid="harness-stats-tokens"
        >
          <p class="text-[11px] font-medium text-[var(--text-secondary)]">
            {{ $t('workspace.harnessStatsTokens') }}
          </p>
          <div v-if="tokenData.length" class="relative">
            <div
              ref="tokensHost"
              class="h-52 w-full"
              role="img"
              :aria-label="$t('workspace.harnessStatsTokens')"
            />
            <p
              class="pointer-events-none absolute left-1/2 top-[44%] -translate-x-1/2 -translate-y-1/2 text-center text-[11px] font-semibold text-[var(--text-primary)]"
            >
              {{ (stats.tokens?.total ?? 0).toLocaleString() }}
              <span class="block text-[9px] font-normal text-[var(--text-tertiary)]">
                {{ $t('workspace.total') }}
              </span>
            </p>
          </div>
          <p
            v-else
            class="flex h-52 items-center justify-center text-[12px] text-[var(--text-tertiary)]"
          >
            —
          </p>
        </div>
        <div
          class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3"
          data-testid="harness-stats-activity"
        >
          <p class="text-[11px] font-medium text-[var(--text-secondary)]">
            {{ $t('workspace.harnessStatsActivity') }}
          </p>
          <div
            ref="activityHost"
            class="h-52 w-full"
            role="img"
            :aria-label="$t('workspace.harnessStatsActivity')"
          />
        </div>
      </div>

      <div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
        <div
          v-for="metric in [
            [$t('workspace.messages'), stats.totalMessages],
            [$t('workspace.messageUser'), stats.userMessages],
            [$t('workspace.messageAssistant'), stats.assistantMessages],
            [$t('workspace.toolCalls'), stats.toolCalls],
            [$t('workspace.toolResults'), stats.toolResults],
            [$t('workspace.harnessActiveTools'), stats.activeTools],
            [$t('workspace.harnessPending'), stats.pendingMessages],
            [$t('workspace.tokenInput'), stats.tokens?.input],
            [$t('workspace.tokenOutput'), stats.tokens?.output],
            [$t('workspace.cacheRead'), stats.tokens?.cacheRead],
            [$t('workspace.harnessCacheWrite'), stats.tokens?.cacheWrite],
            [$t('workspace.total'), stats.tokens?.total]
          ]"
          :key="String(metric[0])"
          class="harness-metric min-h-16"
        >
          <span>{{ metric[0] }}</span>
          <strong>{{ typeof metric[1] === 'number' ? metric[1].toLocaleString() : '—' }}</strong>
        </div>
        <div v-if="stats.cost !== undefined" class="harness-metric min-h-16">
          <span>{{ $t('workspace.harnessCost') }}</span>
          <strong>${{ stats.cost.toFixed(4) }}</strong>
        </div>
      </div>
    </template>
    <p v-else class="mt-4 text-[12px] text-[var(--text-tertiary)]">
      {{ $t('workspace.harnessStatsUnavailable') }}
    </p>
  </section>
</template>

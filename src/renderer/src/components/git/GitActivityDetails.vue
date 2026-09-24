<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { GitActivityDay } from '@shared/types/workspace'
import type { EChartsType } from '@renderer/utils/echarts'
import { authorInitials, summarizeAuthors } from '@shared/workspace/git-activity'
import GitActivityGraph from './GitActivityGraph.vue'
import { summarizeActivity, weeklyActivity, weeklyTooltipLines } from './git-activity-stats'

const props = defineProps<{
  days: GitActivityDay[]
}>()

const { locale, t } = useI18n()
const chartHost = ref<HTMLElement | null>(null)
let chart: EChartsType | null = null
let stopThemeObserver: (() => void) | null = null
let echartsModule: typeof import('@renderer/utils/echarts') | null = null

const summary = computed(() => summarizeActivity(props.days))
const authors = computed(() => summarizeAuthors(props.days))
const weeks = computed(() => weeklyActivity(props.days))
const peakLabel = computed(() => {
  if (!summary.value.peakDate || !summary.value.peakCommits) return '—'
  const date = new Intl.DateTimeFormat(locale.value, {
    month: 'short',
    day: 'numeric'
  }).format(new Date(`${summary.value.peakDate}T12:00:00`))
  return `${summary.value.peakCommits} · ${date}`
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

function weekLabel(start: string): string {
  return new Intl.DateTimeFormat(locale.value, {
    month: 'short',
    day: 'numeric'
  }).format(new Date(`${start}T12:00:00`))
}

function escapeTooltip(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function weekTooltip(index: number): string {
  const week = weeks.value[index]
  if (!week) return ''
  const lines = [
    weekLabel(week.start),
    ...weeklyTooltipLines(week, {
      weekly: t('workspace.gitActivityWeekly'),
      authorCommits: (count) => t('workspace.gitActivityAuthorCommits', { count }),
      more: (count) => t('workspace.gitActivityAuthorsMore', { count })
    })
  ]
  return lines.map((line) => escapeTooltip(line)).join('<br/>')
}

function renderChart(): void {
  if (!chart || !echartsModule) return
  chart.setOption({
    tooltip: {
      ...echartsModule.chartTooltip(),
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: unknown) => {
        const first = Array.isArray(params) ? params[0] : params
        const index = (first as { dataIndex?: number } | undefined)?.dataIndex
        return typeof index === 'number' ? weekTooltip(index) : ''
      }
    },
    grid: { left: 8, right: 12, top: 16, bottom: 4, containLabel: true },
    xAxis: {
      type: 'category',
      data: weeks.value.map((week) => weekLabel(week.start)),
      axisLabel: { color: axisColor(), fontSize: 10, hideOverlap: true },
      axisLine: { lineStyle: { color: splitLineColor() } },
      axisTick: { show: false }
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      axisLabel: { color: axisColor(), fontSize: 10 },
      splitLine: { lineStyle: { color: splitLineColor() } }
    },
    series: [
      {
        type: 'bar',
        name: t('workspace.gitActivityWeekly'),
        barMaxWidth: 18,
        itemStyle: {
          borderRadius: [3, 3, 0, 0],
          color: echartsModule.resolveThemeColor('--accent', '#5b8def')
        },
        data: weeks.value.map((week) => week.commits)
      }
    ]
  })
}

function onResize(): void {
  chart?.resize()
}

onMounted(async () => {
  echartsModule = await import('@renderer/utils/echarts')
  if (chartHost.value && !chart) chart = echartsModule.echarts.init(chartHost.value)
  renderChart()
  stopThemeObserver = echartsModule.observeThemeChanges(renderChart)
  window.addEventListener('resize', onResize)
})

watch(
  () => [props.days, locale.value] as const,
  () => renderChart()
)

onBeforeUnmount(() => {
  stopThemeObserver?.()
  window.removeEventListener('resize', onResize)
  chart?.dispose()
  chart = null
})
</script>

<template>
  <div class="flex flex-col gap-4" data-testid="git-activity-details">
    <div class="grid grid-cols-3 gap-2">
      <div class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-3 py-2">
        <p class="text-[10px] text-[var(--text-tertiary)]">
          {{ $t('workspace.gitActivityTotal') }}
        </p>
        <p class="mt-0.5 text-[16px] font-semibold text-[var(--text-primary)]">
          {{ summary.total.toLocaleString() }}
        </p>
      </div>
      <div class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-3 py-2">
        <p class="text-[10px] text-[var(--text-tertiary)]">
          {{ $t('workspace.gitActivityActiveDays') }}
        </p>
        <p class="mt-0.5 text-[16px] font-semibold text-[var(--text-primary)]">
          {{ summary.activeDays.toLocaleString() }}
        </p>
      </div>
      <div class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-3 py-2">
        <p class="text-[10px] text-[var(--text-tertiary)]">{{ $t('workspace.gitActivityPeak') }}</p>
        <p class="mt-0.5 text-[16px] font-semibold text-[var(--text-primary)]">{{ peakLabel }}</p>
      </div>
    </div>

    <section v-if="authors.length" data-testid="git-activity-authors">
      <p class="mb-2 text-[11px] font-medium text-[var(--text-secondary)]">
        {{ $t('workspace.gitActivityAuthors') }}
        <span class="font-normal text-[var(--text-tertiary)]">{{ authors.length }}</span>
      </p>
      <ul class="flex max-h-48 flex-col gap-1 overflow-y-auto">
        <li
          v-for="author in authors"
          :key="author.email || author.name"
          class="flex items-center gap-2 rounded-[var(--radius-sm)] px-1 py-1"
        >
          <span
            class="flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--accent-tint)] text-[9px] font-semibold text-[var(--accent)]"
            aria-hidden="true"
          >
            {{ authorInitials(author.name || author.email) }}
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-[12px] text-[var(--text-primary)]">{{
              author.name
            }}</span>
            <span
              v-if="author.email"
              class="block truncate text-[10px] text-[var(--text-tertiary)]"
            >
              {{ author.email }}
            </span>
          </span>
          <span class="shrink-0 text-[11px] tabular-nums text-[var(--text-secondary)]">
            {{ $t('workspace.gitActivityAuthorCommits', { count: author.commits }) }}
          </span>
        </li>
      </ul>
    </section>

    <GitActivityGraph :days="days" :max-weeks="26" :cell-max="16" show-months hide-summary />

    <div>
      <p class="mb-1 text-[11px] font-medium text-[var(--text-secondary)]">
        {{ $t('workspace.gitActivityWeekly') }}
      </p>
      <div
        ref="chartHost"
        data-testid="git-activity-weekly-chart"
        class="h-56 w-full"
        role="img"
        :aria-label="$t('workspace.gitActivityWeekly')"
      />
    </div>
  </div>
</template>

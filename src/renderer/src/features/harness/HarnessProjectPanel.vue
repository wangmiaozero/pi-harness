<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Download, Target } from '@lucide/vue'
import type { HarnessStatsRange } from '@shared/types/harness'
import { useHarnessStore } from '@renderer/stores/harness'

const { t } = useI18n()
const harness = useHarnessStore()

const stats = computed(() => harness.projectStats)
const baseline = computed(() => harness.baseline)
const settings = computed(() => harness.storeSettings)

const rangeOptions: Array<{ value: HarnessStatsRange; label: string }> = [
  { value: 'today', label: t('workspace.harnessRangeToday') },
  { value: '7d', label: t('workspace.harnessRange7d') },
  { value: '30d', label: t('workspace.harnessRange30d') },
  { value: 'all', label: t('workspace.harnessRangeAll') }
]

function percent(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`
}

function duration(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m${Math.floor((ms % 60_000) / 1000)}s`
}

async function setRange(range: HarnessStatsRange): Promise<void> {
  await harness.setStatsRange(range)
}

async function updateRetention(days: string): Promise<void> {
  if (!settings.value) return
  await harness.updateStoreSettings({
    schemaVersion: 1,
    retentionDays: Number(days) as 7 | 30 | 90 | 0,
    maxEventsPerRun: settings.value.maxEventsPerRun
  })
}

async function exportDebug(): Promise<void> {
  await harness.exportDebugBundle()
}
</script>

<template>
  <section class="harness-card max-w-4xl" data-testid="harness-project-panel">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h3 class="harness-card-title">{{ t('workspace.harnessProject') }}</h3>
      <div class="flex items-center gap-1">
        <button
          v-for="option in rangeOptions"
          :key="option.value"
          type="button"
          class="rounded-[var(--radius-sm)] border px-2 py-0.5 text-[10.5px] transition-colors"
          :class="harness.statsRange === option.value
            ? 'border-[var(--accent-border)] bg-[var(--accent-tint)] text-[var(--accent)]'
            : 'border-transparent text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]'"
          :aria-pressed="harness.statsRange === option.value"
          @click="setRange(option.value)"
        >
          {{ option.label }}
        </button>
      </div>
    </div>

    <p v-if="stats?.cwd" class="mt-1 truncate font-mono text-[10px] text-[var(--text-tertiary)]">
      {{ stats.cwd }}
    </p>

    <div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
      <div class="harness-metric min-h-14">
        <span>{{ t('workspace.harnessProjectRuns') }}</span>
        <strong>{{ stats?.totalRuns ?? 0 }}</strong>
      </div>
      <div class="harness-metric min-h-14">
        <span>{{ t('workspace.harnessProjectSuccessRate') }}</span>
        <strong>{{ percent(stats?.successRate ?? null) }}</strong>
      </div>
      <div class="harness-metric min-h-14">
        <span>{{ t('workspace.harnessProjectFailureRate') }}</span>
        <strong>{{ percent(stats?.failureRate ?? null) }}</strong>
      </div>
      <div class="harness-metric min-h-14">
        <span>{{ t('workspace.harnessProjectSessions') }}</span>
        <strong>{{ stats?.sessionCount ?? 0 }}</strong>
      </div>
      <div class="harness-metric min-h-14">
        <span>{{ t('workspace.harnessProjectAvgDuration') }}</span>
        <strong>{{ duration(stats?.averageDurationMs ?? null) }}</strong>
      </div>
      <div class="harness-metric min-h-14">
        <span>{{ t('workspace.harnessProjectAvgTokens') }}</span>
        <strong>{{ (stats?.averageTokens ?? 0).toLocaleString() }}</strong>
      </div>
      <div class="harness-metric min-h-14">
        <span>{{ t('workspace.harnessProjectEvalPassRate') }}</span>
        <strong>{{ percent(stats?.evaluationPassRate ?? null) }}</strong>
      </div>
      <div class="harness-metric min-h-14">
        <span>{{ t('workspace.harnessProjectRecoveryRate') }}</span>
        <strong>{{ percent(stats?.recoveryRate ?? null) }}</strong>
      </div>
    </div>

    <div v-if="stats?.topFailureReasons.length" class="mt-4">
      <p class="mb-1.5 text-[10.5px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
        {{ t('workspace.harnessProjectTopFailures') }}
      </p>
      <ul class="space-y-1">
        <li
          v-for="reason in stats.topFailureReasons"
          :key="reason.category"
          class="flex items-center gap-2 text-[11px]"
        >
          <span class="w-40 shrink-0 truncate text-[var(--text-secondary)]">
            {{ t(`workspace.harnessDiagCategory.${reason.category}`) }}
          </span>
          <div class="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--bg-hover)]">
            <div
              class="h-full rounded-full bg-[var(--error)]"
              :style="{ width: `${reason.percent}%` }"
            />
          </div>
          <span class="w-14 shrink-0 text-right tabular-nums text-[var(--text-tertiary)]">
            {{ reason.count }} · {{ reason.percent }}%
          </span>
        </li>
      </ul>
    </div>

    <div v-if="baseline" class="mt-4 flex flex-wrap items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2">
      <Target class="size-3.5 shrink-0 text-[var(--accent)]" />
      <span class="min-w-0 flex-1 truncate text-[11px] text-[var(--text-secondary)]">
        {{ t('workspace.harnessBaselineCurrent') }}: {{ baseline.runLabel }}
      </span>
    </div>

    <div class="mt-4 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="text-[11.5px] text-[var(--text-secondary)]">
          {{ t('workspace.harnessRetentionLabel') }}
        </span>
        <select
          v-if="settings"
          class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1 text-[11px] text-[var(--text-primary)]"
          :value="settings.retentionDays"
          :disabled="harness.mutating"
          data-testid="harness-retention-select"
          @change="updateRetention(($event.target as HTMLSelectElement).value)"
        >
          <option value="7">{{ t('workspace.harnessRetention7d') }}</option>
          <option value="30">{{ t('workspace.harnessRetention30d') }}</option>
          <option value="90">{{ t('workspace.harnessRetention90d') }}</option>
          <option value="0">{{ t('workspace.harnessRetentionForever') }}</option>
        </select>
      </div>
      <p class="mt-1.5 text-[10.5px] text-[var(--text-tertiary)]">
        {{ t('workspace.harnessRetentionHint') }}
      </p>
      <button
        type="button"
        class="mt-2 flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50"
        :disabled="harness.mutating"
        @click="exportDebug"
      >
        <Download class="size-3" />
        {{ t('workspace.harnessExportDebugBundle') }}
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileJson,
  FileText,
  GitBranch,
  Gauge,
  Pause,
  Play,
  Repeat2,
  Target,
  TrendingDown,
  TrendingUp,
  XCircle
} from '@lucide/vue'
import type {
  HarnessDiagnosticSeverity,
  HarnessRegressionFinding,
  HarnessRunDetail
} from '@shared/types/harness'
import { useHarnessStore } from '@renderer/stores/harness'
import { useAgentNames } from '@renderer/composables/useAgentNames'

const { t, locale } = useI18n()
const harness = useHarnessStore()
const { agentName } = useAgentNames()

const SPEEDS = [0.5, 1, 2, 4, 0] as const
const speedIndex = ref(1)
const playing = ref(false)
const playTimer: { value: ReturnType<typeof setInterval> | null } = { value: null }
const cursor = ref(0)

const detail = computed<HarnessRunDetail | null>(() => harness.runDetail)
const events = computed(() => detail.value?.trace?.events ?? [])
const total = computed(() => events.value.length)

const speed = computed(() => SPEEDS[speedIndex.value])
const speedLabel = computed(() =>
  speed.value === 0 ? t('workspace.harnessReplayInstant') : `${speed.value}x`
)

const progress = computed(() => (total.value ? (cursor.value + 1) / total.value : 0))

const pastEvents = computed(() =>
  events.value
    .slice(0, cursor.value + 1)
    .slice(-60)
    .reverse()
)
const activeEvent = computed(() => events.value[cursor.value] ?? null)

watch(
  () => detail.value?.run.id,
  () => {
    stop()
    cursor.value = 0
  }
)

watch(playing, (next) => (next ? startTimer() : stopTimer()))

onMounted(() => {
  if (harness.currentRunId && !detail.value) void harness.loadRunDetail(harness.currentRunId)
})
onBeforeUnmount(stop)

function startTimer(): void {
  stopTimer()
  if (speed.value === 0) {
    cursor.value = Math.max(0, total.value - 1)
    playing.value = false
    return
  }
  playTimer.value = setInterval(() => {
    if (cursor.value >= total.value - 1) {
      playing.value = false
      return
    }
    cursor.value += 1
  }, 700 / speed.value)
}

function stopTimer(): void {
  if (playTimer.value) clearInterval(playTimer.value)
  playTimer.value = null
}

function stop(): void {
  playing.value = false
}

function toggle(): void {
  if (!total.value) return
  if (!playing.value && cursor.value >= total.value - 1) cursor.value = 0
  playing.value = !playing.value
}

function step(delta: number): void {
  stop()
  cursor.value = Math.min(Math.max(0, cursor.value + delta), Math.max(0, total.value - 1))
}

function cycleSpeed(): void {
  speedIndex.value = (speedIndex.value + 1) % SPEEDS.length
}

function time(timestamp: number): string {
  return new Intl.DateTimeFormat(locale.value, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(timestamp)
}

function duration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m${Math.floor((ms % 60_000) / 1000)}s`
}

function relationLabel(relation: string): string {
  return t(`workspace.harnessRunRelation.${relation}`)
}

const severityTone: Record<HarnessDiagnosticSeverity, string> = {
  critical: 'border-[var(--error)] text-[var(--error)]',
  error: 'border-[var(--error)] text-[var(--error)]',
  warning: 'border-[var(--warning)] text-[var(--warning)]',
  info: 'border-[var(--border-subtle)] text-[var(--text-secondary)]'
}

const findingTone: Record<HarnessRegressionFinding['severity'], string> = {
  regression: 'text-[var(--error)]',
  warning: 'text-[var(--warning)]',
  improvement: 'text-[var(--success)]',
  info: 'text-[var(--text-tertiary)]'
}

async function fork(): Promise<void> {
  if (!detail.value) return
  await harness.forkRun(detail.value.run.id, { mode: 'fork' })
}

async function rerun(): Promise<void> {
  if (!detail.value) return
  await harness.forkRun(detail.value.run.id, { mode: 'rerun' })
}

async function setBaseline(): Promise<void> {
  if (!detail.value) return
  await harness.setBaseline(detail.value.run.id)
}

async function exportJson(): Promise<void> {
  if (!detail.value) return
  await harness.exportRun(detail.value.run.id, 'json')
}

async function exportMarkdown(): Promise<void> {
  if (!detail.value) return
  await harness.exportRun(detail.value.run.id, 'markdown')
}

async function exportDebug(): Promise<void> {
  if (!detail.value) return
  await harness.exportDebugBundle(detail.value.run.id)
}
</script>

<template>
  <section class="harness-card" data-testid="harness-run-detail-panel">
    <template v-if="detail">
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div class="min-w-0">
          <h3 class="harness-card-title truncate">
            {{ detail.run.prompt || t('workspace.harnessRunUntitled') }}
          </h3>
          <p
            class="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10.5px] text-[var(--text-tertiary)]"
          >
            <span :data-testid="`harness-run-detail-relation`">{{
              relationLabel(detail.run.relation)
            }}</span>
            <span>·</span>
            <span
              v-if="agentName(detail.run.agentId)"
              class="inline-flex items-center gap-1 text-[var(--accent)]"
            >
              <Bot class="size-3" />{{ agentName(detail.run.agentId) }}
            </span>
            <span v-if="agentName(detail.run.agentId)">·</span>
            <span>{{ detail.run.model ?? '—' }}</span>
            <span v-if="detail.run.provider">· {{ detail.run.provider }}</span>
            <span v-if="detail.run.forkedFromRunId"
              >· forked from {{ detail.run.forkedFromRunId.slice(0, 18) }}</span
            >
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            class="flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50"
            :disabled="harness.mutating"
            :title="t('workspace.harnessForkRunHint')"
            @click="fork"
          >
            <GitBranch class="size-3" />
            {{ t('workspace.harnessForkRun') }}
          </button>
          <button
            type="button"
            class="flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50"
            :disabled="harness.mutating"
            :title="t('workspace.harnessRerunRunHint')"
            @click="rerun"
          >
            <Repeat2 class="size-3" />
            {{ t('workspace.harnessRerunRun') }}
          </button>
          <button
            type="button"
            class="flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50"
            :disabled="harness.mutating"
            :title="t('workspace.harnessSetBaselineHint')"
            @click="setBaseline"
          >
            <Target class="size-3" />
            {{ t('workspace.harnessSetBaseline') }}
          </button>
          <button
            type="button"
            class="flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50"
            :disabled="harness.mutating"
            @click="exportJson"
          >
            <FileJson class="size-3" />
            JSON
          </button>
          <button
            type="button"
            class="flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50"
            :disabled="harness.mutating"
            @click="exportMarkdown"
          >
            <FileText class="size-3" />
            MD
          </button>
          <button
            type="button"
            class="flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50"
            :disabled="harness.mutating"
            :title="t('workspace.harnessExportDebugBundle')"
            @click="exportDebug"
          >
            <Download class="size-3" />
            {{ t('workspace.harnessExportDebugBundle') }}
          </button>
        </div>
      </div>

      <div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div class="harness-metric min-h-14">
          <span>{{ t('workspace.harnessRunTokens') }}</span>
          <strong>{{ detail.run.usage.totalTokens.toLocaleString() }}</strong>
        </div>
        <div class="harness-metric min-h-14">
          <span>{{ t('workspace.harnessRunCost') }}</span>
          <strong>{{
            detail.run.usage.estimatedCost === null
              ? '—'
              : `$${detail.run.usage.estimatedCost.toFixed(4)}`
          }}</strong>
        </div>
        <div class="harness-metric min-h-14">
          <span>{{ t('workspace.harnessRunToolCalls') }}</span>
          <strong>{{ detail.run.toolCallCount }}</strong>
        </div>
        <div class="harness-metric min-h-14">
          <span>{{ t('workspace.harnessRunDuration') }}</span>
          <strong>{{
            detail.run.finishedAt ? duration(detail.run.finishedAt - detail.run.startedAt) : '—'
          }}</strong>
        </div>
      </div>

      <!-- Replay player -->
      <div
        v-if="total"
        class="mt-4 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3"
        data-testid="harness-replay-player"
      >
        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="flex size-7 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border-subtle)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)]"
            :aria-label="
              playing ? t('workspace.harnessReplayPause') : t('workspace.harnessReplayPlay')
            "
            :data-testid="`harness-replay-${playing ? 'pause' : 'play'}`"
            @click="toggle"
          >
            <component :is="playing ? Pause : Play" class="size-3.5" />
          </button>
          <button
            type="button"
            class="flex size-7 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border-subtle)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)]"
            :aria-label="t('workspace.harnessReplayStepBack')"
            @click="step(-1)"
          >
            <ChevronLeft class="size-3.5" />
          </button>
          <button
            type="button"
            class="flex size-7 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border-subtle)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)]"
            :aria-label="t('workspace.harnessReplayStepForward')"
            @click="step(1)"
          >
            <ChevronRight class="size-3.5" />
          </button>
          <button
            type="button"
            class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 py-1 text-[10.5px] tabular-nums text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)]"
            :title="t('workspace.harnessReplaySpeed')"
            data-testid="harness-replay-speed"
            @click="cycleSpeed"
          >
            {{ speedLabel }}
          </button>
          <span class="text-[10.5px] tabular-nums text-[var(--text-tertiary)]">
            {{ cursor + 1 }} / {{ total }}
          </span>
          <div class="ml-auto h-1.5 w-32 overflow-hidden rounded-full bg-[var(--bg-hover)]">
            <div
              class="h-full rounded-full bg-[var(--accent)] transition-[width] duration-200"
              :style="{ width: `${progress * 100}%` }"
            />
          </div>
        </div>

        <p
          v-if="activeEvent"
          class="mt-2 truncate font-mono text-[10.5px] text-[var(--text-secondary)]"
          :data-testid="`harness-replay-current`"
        >
          {{ time(activeEvent.event.timestamp) }} · {{ activeEvent.event.type }}
        </p>

        <ol class="mt-2 max-h-48 space-y-0.5 overflow-y-auto pr-1 font-mono text-[10.5px]">
          <li
            v-for="item in pastEvents"
            :key="item.id"
            class="flex items-center gap-2 text-[var(--text-secondary)]"
          >
            <span class="text-[var(--text-tertiary)]">{{ time(item.event.timestamp) }}</span>
            <span
              class="size-1.5 shrink-0 rounded-full"
              :class="
                item.event.type.endsWith('failed') || item.event.type.endsWith('error')
                  ? 'bg-[var(--error)]'
                  : item.event.type.endsWith('completed')
                    ? 'bg-[var(--success)]'
                    : 'bg-[var(--text-disabled)]'
              "
            />
            <span class="truncate">{{ item.event.type }}</span>
          </li>
        </ol>
        <p v-if="detail.trace?.source" class="mt-2 text-[10px] text-[var(--text-tertiary)]">
          {{ t('workspace.harnessReplaySource') }}:
          {{ t(`workspace.harnessTraceSource.${detail.trace.source}`) }}
        </p>
      </div>
      <p v-else class="mt-4 text-[11.5px] text-[var(--text-tertiary)]">
        {{ t('workspace.harnessReplayEmpty') }}
      </p>

      <!-- Diagnostics -->
      <div v-if="detail.diagnostics.length" class="mt-4 space-y-1.5">
        <p class="text-[10.5px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
          {{ t('workspace.harnessDiagnostics') }}
        </p>
        <div
          v-for="diagnostic in detail.diagnostics"
          :key="diagnostic.id"
          class="rounded-[var(--radius-sm)] border px-3 py-2"
          :class="severityTone[diagnostic.severity]"
          :data-testid="`harness-diagnostic`"
        >
          <div class="flex flex-wrap items-center gap-2 text-[12px] font-medium">
            <component
              :is="
                diagnostic.severity === 'info' || diagnostic.severity === 'warning'
                  ? AlertTriangle
                  : XCircle
              "
              class="size-3.5"
            />
            {{ diagnostic.title }}
            <span class="text-[10px] font-normal text-[var(--text-tertiary)]">
              {{ diagnostic.category }}
            </span>
          </div>
          <p class="mt-1 text-[11px] text-[var(--text-secondary)]">{{ diagnostic.message }}</p>
          <p v-if="diagnostic.recommendation" class="mt-1 text-[11px] text-[var(--text-secondary)]">
            {{ t('workspace.harnessDiagRecommendation') }}: {{ diagnostic.recommendation }}
          </p>
          <div v-if="diagnostic.causeChain.length" class="mt-2">
            <p class="text-[10px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
              {{ t('workspace.harnessDiagCauseChain') }}
            </p>
            <ol class="mt-1 space-y-0.5">
              <li
                v-for="(cause, index) in diagnostic.causeChain"
                :key="index"
                class="flex items-start gap-1.5 text-[11px] text-[var(--text-secondary)]"
              >
                <span class="text-[var(--text-tertiary)]">{{ index + 1 }}.</span>
                <span>{{ cause.title }} — {{ cause.message }}</span>
              </li>
            </ol>
          </div>
        </div>
      </div>

      <!-- Insights -->
      <div v-if="detail.insights.length" class="mt-4">
        <p
          class="mb-1.5 text-[10.5px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]"
        >
          {{ t('workspace.harnessInsights') }}
        </p>
        <div class="flex flex-wrap gap-1.5">
          <span
            v-for="insight in detail.insights"
            :key="insight.id"
            class="inline-flex items-center gap-1 rounded-full border border-[var(--border-subtle)] px-2 py-0.5 text-[10.5px] text-[var(--text-secondary)]"
            :data-testid="`harness-insight`"
          >
            <component
              :is="
                insight.kind.includes('delta') && Number(insight.params.percent) > 0
                  ? TrendingUp
                  : insight.kind.includes('delta')
                    ? TrendingDown
                    : Gauge
              "
              class="size-3"
            />
            {{ t(`workspace.harnessInsight.${insight.kind}`, insight.params) }}
          </span>
        </div>
      </div>

      <!-- Regression vs baseline -->
      <div v-if="detail.regression" class="mt-4">
        <p
          class="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]"
        >
          <Target class="size-3" />
          {{ t('workspace.harnessRegressionVsBaseline') }}:
          {{ detail.regression.baseline.runLabel }}
        </p>
        <p
          v-if="!detail.regression.findings.length"
          class="text-[11px] text-[var(--text-tertiary)]"
        >
          {{ t('workspace.harnessRegressionNoFindings') }}
        </p>
        <ul v-else class="space-y-0.5">
          <li
            v-for="finding in detail.regression.findings"
            :key="finding.id"
            class="flex items-center gap-2 text-[11px]"
            :class="findingTone[finding.severity]"
          >
            <component
              :is="
                finding.severity === 'improvement'
                  ? CheckCircle2
                  : finding.severity === 'info'
                    ? Activity
                    : AlertTriangle
              "
              class="size-3 shrink-0"
            />
            <span class="font-medium">{{
              t(`workspace.harnessRegressionMetric.${finding.metric}`)
            }}</span>
            <span class="text-[var(--text-secondary)]">{{ finding.message }}</span>
            <span v-if="finding.deltaPercent !== null" class="tabular-nums">
              {{ finding.deltaPercent > 0 ? '+' : '' }}{{ finding.deltaPercent }}%
            </span>
          </li>
        </ul>
      </div>

      <!-- Artifacts -->
      <div v-if="detail.artifacts.length" class="mt-4">
        <p
          class="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]"
        >
          <Copy class="size-3" />
          {{ t('workspace.harnessArtifacts') }} ({{ detail.artifacts.length }})
        </p>
        <ul class="flex flex-wrap gap-1.5">
          <li
            v-for="artifact in detail.artifacts.slice(0, 12)"
            :key="artifact.id"
            class="rounded-full border border-[var(--border-subtle)] px-2 py-0.5 text-[10.5px] text-[var(--text-secondary)]"
          >
            {{ t(`workspace.harnessArtifactType.${artifact.type}`) }}: {{ artifact.name }}
          </li>
        </ul>
      </div>
    </template>

    <template v-else>
      <h3 class="harness-card-title">{{ t('workspace.harnessRunDetail') }}</h3>
      <p class="mt-3 text-[12px] text-[var(--text-tertiary)]">
        {{ t('workspace.harnessRunDetailEmpty') }}
      </p>
    </template>
  </section>
</template>

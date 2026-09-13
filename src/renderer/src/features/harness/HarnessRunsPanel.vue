<script setup lang="ts">
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Clock,
  Coins,
  Hammer,
  Loader2,
  RotateCcw,
  ShieldAlert,
  SkipForward,
  Wrench,
  XCircle
} from '@lucide/vue'
import type { HarnessRun, HarnessRunStatus, HarnessRunStep } from '@shared/types/harness'
import { useHarnessStore } from '@renderer/stores/harness'
import { useAgentNames } from '@renderer/composables/useAgentNames'

const { t, locale } = useI18n()
const harness = useHarnessStore()
const { agentName, hasUnknownAgent, refreshAgents } = useAgentNames()

const runs = computed<HarnessRun[]>(() => [...harness.runs])
const selectedEvaluation = computed(
  () => harness.evaluations.find((item) => item.runId === harness.currentRunId) ?? null
)

const relationTone: Record<string, string> = {
  original: 'text-[var(--text-tertiary)]',
  fork: 'text-[var(--accent)]',
  retry: 'text-[var(--warning)]',
  recovery: 'text-[var(--success)]',
  rerun: 'text-[var(--accent)]'
}

const statusTone: Record<HarnessRunStatus, string> = {
  queued: 'text-[var(--text-tertiary)]',
  running: 'text-[var(--accent)]',
  waiting: 'text-[var(--warning)]',
  'tool-calling': 'text-[var(--accent)]',
  verifying: 'text-[var(--warning)]',
  success: 'text-[var(--success)]',
  failed: 'text-[var(--error)]',
  aborted: 'text-[var(--text-tertiary)]',
  recovered: 'text-[var(--success)]'
}

const stepTone: Record<HarnessRunStep['status'], string> = {
  running: 'text-[var(--accent)]',
  success: 'text-[var(--success)]',
  failed: 'text-[var(--error)]',
  skipped: 'text-[var(--text-tertiary)]'
}

const stepIcon: Record<HarnessRunStep['kind'], typeof Wrench> = {
  message: Hammer,
  tool: Wrench,
  policy: ShieldAlert,
  compaction: CircleDashed,
  error: AlertTriangle
}

function statusLabel(status: HarnessRunStatus): string {
  return t(`workspace.harnessRunStatus.${status}`)
}

function stepStatusLabel(status: HarnessRunStep['status']): string {
  return t(`workspace.harnessRunStep.${status}`)
}

function time(timestamp: number): string {
  return new Intl.DateTimeFormat(locale.value, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(timestamp)
}

function duration(run: HarnessRun): string {
  const end = run.finishedAt ?? Date.now()
  const ms = Math.max(0, end - run.startedAt)
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m${Math.floor((ms % 60_000) / 1000)}s`
}

function cost(run: HarnessRun): string {
  return run.usage.estimatedCost === null ? '—' : `$${run.usage.estimatedCost.toFixed(4)}`
}

function tokens(run: HarnessRun): string {
  return run.usage.totalTokens.toLocaleString()
}

const emit = defineEmits<{ openDetail: [runId: string] }>()

function selectRun(runId: string): void {
  harness.currentRunId = harness.currentRunId === runId ? null : runId
}

async function openDetail(runId: string): Promise<void> {
  emit('openDetail', runId)
}

async function fork(runId: string): Promise<void> {
  await harness.forkRun(runId, { mode: 'fork' })
}

async function rerun(runId: string): Promise<void> {
  await harness.forkRun(runId, { mode: 'rerun' })
}

async function setScope(scope: 'session' | 'project'): Promise<void> {
  await harness.setRunScope(scope)
}

async function evaluate(runId: string): Promise<void> {
  await harness.evaluateRun(runId)
}

async function retry(): Promise<void> {
  await harness.retryLastRun()
}

const retryable = computed(
  () =>
    runs.value.some(
      (run) => (run.status === 'failed' || run.status === 'aborted') && run.prompt.trim()
    ) ?? false
)

// Orchestration runs may outdate the shared agent cache (new or deleted
// agents); re-resolve instead of silently dropping attribution.
watch(
  () => hasUnknownAgent(runs.value),
  (unknown, previous) => {
    if (unknown && !previous) void refreshAgents()
  },
  { immediate: true }
)
</script>

<template>
  <section class="harness-card max-w-4xl" data-testid="harness-runs-panel">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h3 class="harness-card-title">{{ $t('workspace.harnessRuns') }}</h3>
      <div class="flex items-center gap-1">
        <button
          v-for="scope in ['session', 'project'] as const"
          :key="scope"
          type="button"
          class="rounded-[var(--radius-sm)] border px-2 py-0.5 text-[10.5px] transition-colors"
          :class="harness.runScope === scope
            ? 'border-[var(--accent-border)] bg-[var(--accent-tint)] text-[var(--accent)]'
            : 'border-transparent text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]'"
          :aria-pressed="harness.runScope === scope"
          :data-testid="`harness-runs-scope-${scope}`"
          @click="setScope(scope)"
        >
          {{ $t(`workspace.harnessRunsScope_${scope}`) }}
        </button>
        <button
          type="button"
          class="flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50"
          :disabled="!retryable || harness.mutating"
          :title="$t('workspace.harnessRetryLastRunHint')"
          @click="retry"
        >
          <RotateCcw class="size-3" />
          {{ $t('workspace.harnessRetryLastRun') }}
        </button>
      </div>
    </div>

    <p v-if="!runs.length" class="mt-4 text-[12px] text-[var(--text-tertiary)]">
      {{ $t('workspace.harnessRunsEmpty') }}
    </p>

    <ol v-else class="mt-3 space-y-1.5">
      <li v-for="run in runs" :key="run.id">
        <button
          type="button"
          class="w-full rounded-[var(--radius-sm)] border px-3 py-2 text-left transition-colors"
          :class="
            harness.currentRunId === run.id
              ? 'border-[var(--accent-border)] bg-[var(--accent-tint)]'
              : 'border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]'
          "
          data-testid="harness-run-item"
          @click="selectRun(run.id)"
        >
          <div class="flex items-center gap-2">
            <component
              :is="run.status === 'success' ? CheckCircle2 : run.status === 'failed' ? XCircle : run.status === 'aborted' ? SkipForward : Loader2"
              class="size-3.5 shrink-0"
              :class="[statusTone[run.status], run.status === 'running' ? 'animate-spin' : '']"
            />
            <span class="min-w-0 flex-1 truncate text-[12px] text-[var(--text-primary)]">
              {{ run.prompt || t('workspace.harnessRunUntitled') }}
            </span>
            <span class="shrink-0 text-[10.5px] tabular-nums text-[var(--text-tertiary)]">
              {{ time(run.startedAt) }} · {{ duration(run) }}
            </span>
            <ChevronRight
              class="size-3 shrink-0 text-[var(--text-tertiary)] transition-transform"
              :class="harness.currentRunId === run.id ? 'rotate-90' : ''"
            />
          </div>
          <div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 pl-5.5 text-[10.5px] text-[var(--text-tertiary)]">
            <span :class="statusTone[run.status]">{{ statusLabel(run.status) }}</span>
            <span class="inline-flex items-center gap-1">
              <Coins class="size-3" />{{ tokens(run) }} tokens
            </span>
            <span v-if="run.usage.estimatedCost !== null" class="inline-flex items-center gap-1">
              {{ cost(run) }}
            </span>
            <span class="inline-flex items-center gap-1">
              <Hammer class="size-3" />{{ run.toolCallCount }}
              <template v-if="run.toolFailureCount">({{ run.toolFailureCount }} ✗)</template>
            </span>
            <span v-if="run.budgetExceeded" class="inline-flex items-center gap-1 text-[var(--error)]">
              <AlertTriangle class="size-3" />{{ run.budgetExceeded }}
            </span>
            <span v-if="run.agentId && agentName(run.agentId)" class="inline-flex items-center gap-1 text-[var(--accent)]">
              <Bot class="size-3" />{{ agentName(run.agentId) }}
            </span>
            <span v-if="run.source === 'history'" class="text-[var(--text-disabled)]">
              {{ $t('workspace.harnessRunSourceHistory') }}
            </span>
            <span
              v-if="run.relation !== 'original'"
              :class="relationTone[run.relation] ?? ''"
              :data-testid="`harness-run-relation`"
            >
              {{ $t(`workspace.harnessRunRelation.${run.relation}`) }}
            </span>
          </div>
        </button>

        <div
          v-if="harness.currentRunId === run.id"
          class="mx-3 mt-1.5 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3"
          :data-testid="`harness-run-detail`"
        >
          <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div class="harness-metric min-h-14">
              <span>{{ $t('workspace.harnessRunTokens') }}</span>
              <strong>{{ tokens(run) }}</strong>
            </div>
            <div class="harness-metric min-h-14">
              <span>{{ $t('workspace.harnessRunCost') }}</span>
              <strong>{{ cost(run) }}</strong>
            </div>
            <div class="harness-metric min-h-14">
              <span>{{ $t('workspace.harnessRunToolCalls') }}</span>
              <strong>{{ run.toolCallCount }}</strong>
            </div>
            <div class="harness-metric min-h-14">
              <span>{{ $t('workspace.harnessRunDuration') }}</span>
              <strong>{{ duration(run) }}</strong>
            </div>
          </div>

          <p v-if="run.error" class="mt-2 text-[11px] text-[var(--error)]" role="alert">
            {{ run.error }}
          </p>
          <p v-if="run.result" class="mt-2 line-clamp-3 text-[11px] text-[var(--text-secondary)]">
            {{ run.result }}
          </p>

          <div v-if="run.steps.length" class="mt-3">
            <p class="mb-1.5 text-[10.5px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
              {{ $t('workspace.harnessRunSteps') }}
            </p>
            <ol class="max-h-56 space-y-1 overflow-y-auto pr-1">
              <li
                v-for="step in run.steps"
                :key="step.id"
                class="flex items-center gap-2 text-[11px]"
                :data-testid="`harness-run-step`"
              >
                <component
                  :is="stepIcon[step.kind]"
                  class="size-3 shrink-0"
                  :class="stepTone[step.status]"
                />
                <span class="min-w-0 flex-1 truncate text-[var(--text-secondary)]">
                  {{ step.name }}
                </span>
                <span v-if="step.detail" class="max-w-[45%] truncate text-[10px] text-[var(--text-tertiary)]">
                  {{ step.detail }}
                </span>
                <span class="shrink-0 text-[10px] text-[var(--text-tertiary)]">
                  {{ stepStatusLabel(step.status) }}
                </span>
              </li>
            </ol>
          </div>

          <div
            v-if="selectedEvaluation"
            class="mt-3 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] p-2"
          >
            <div class="flex items-center gap-1.5 text-[11px]">
              <component
                :is="selectedEvaluation.status === 'passed' ? CheckCircle2 : selectedEvaluation.status === 'warning' ? AlertTriangle : XCircle"
                class="size-3.5"
                :class="selectedEvaluation.status === 'passed' ? 'text-[var(--success)]' : selectedEvaluation.status === 'warning' ? 'text-[var(--warning)]' : 'text-[var(--error)]'"
              />
              <span class="text-[var(--text-secondary)]">
                {{ $t('workspace.harnessEvaluation') }}:
                {{ $t(`workspace.harnessEvaluationStatus.${selectedEvaluation.status}`) }}
              </span>
            </div>
          </div>

          <div class="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50"
              :disabled="harness.mutating || ['queued', 'running', 'waiting', 'tool-calling', 'verifying'].includes(run.status)"
              @click="evaluate(run.id)"
            >
              <span class="inline-flex items-center gap-1">
                <Loader2 v-if="harness.mutating" class="size-3 animate-spin" />
                {{ $t('workspace.harnessEvaluateRun') }}
              </span>
            </button>
            <button
              type="button"
              class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50"
              :data-testid="`harness-run-open-detail`"
              @click="openDetail(run.id)"
            >
              {{ $t('workspace.harnessRunOpenDetail') }}
            </button>
            <button
              type="button"
              class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50"
              :disabled="harness.mutating"
              :title="$t('workspace.harnessForkRunHint')"
              @click="fork(run.id)"
            >
              {{ $t('workspace.harnessForkRun') }}
            </button>
            <button
              type="button"
              class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50"
              :disabled="harness.mutating"
              :title="$t('workspace.harnessRerunRunHint')"
              @click="rerun(run.id)"
            >
              {{ $t('workspace.harnessRerunRun') }}
            </button>
            <span v-if="run.checkpointIds.length" class="inline-flex items-center gap-1 text-[10.5px] text-[var(--text-tertiary)]">
              <Clock class="size-3" />{{ run.checkpointIds.length }}
              {{ $t('workspace.harnessCheckpoints') }}
            </span>
          </div>
        </div>
      </li>
    </ol>
  </section>
</template>

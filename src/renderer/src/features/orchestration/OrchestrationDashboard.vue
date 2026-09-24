<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useOrchestrationStore } from '@renderer/stores/orchestration'
import type { HarnessEvent } from '@shared/types/harness'

const { locale, t } = useI18n()
const store = useOrchestrationStore()

const orch = computed(() => store.snapshot?.orchestration ?? null)
const costShares = computed(() => store.snapshot?.costShares ?? [])
const evaluation = computed(() => store.snapshot?.evaluation ?? null)
const conflicts = computed(() => store.snapshot?.conflicts ?? null)

const timeline = computed<HarnessEvent[]>(() => store.snapshot?.timeline.slice(-60) ?? [])

const taskStats = computed(() => {
  const tasks = store.snapshot?.tasks ?? []
  const counts = new Map<string, number>()
  for (const task of tasks) counts.set(task.status, (counts.get(task.status) ?? 0) + 1)
  return tasks.length ? [...counts.entries()].map(([status, count]) => ({ status, count })) : []
})

const budgetTokens = computed(() => {
  const max = orch.value?.budget.maxTokens
  const used = orch.value?.totalTokens ?? 0
  if (max === null || max === undefined || max === 0) return null
  return Math.min(100, (used / max) * 100)
})

const budgetCost = computed(() => {
  const max = orch.value?.budget.maxCost
  const used = orch.value?.estimatedCost ?? 0
  if (max === null || max === undefined || max === 0) return null
  return Math.min(100, (used / max) * 100)
})

function fmtTime(timestamp: number | null): string {
  if (!timestamp) return '—'
  return new Intl.DateTimeFormat(locale.value, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(timestamp)
}

const agentNameById = computed<Map<string, string>>(
  () => new Map((store.snapshot?.agents ?? []).map((item) => [item.agent.id, item.agent.name]))
)

function agentName(agentId: string): string {
  return agentNameById.value.get(agentId) ?? agentId.slice(0, 8)
}

function fmtTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`
  return String(tokens)
}

const eventLabel: Record<string, string> = {
  'orchestration.created': t('orchestration.eventCreated'),
  'orchestration.started': t('orchestration.eventStarted'),
  'orchestration.paused': t('orchestration.eventPaused'),
  'orchestration.resumed': t('orchestration.eventResumed'),
  'orchestration.completed': t('orchestration.eventCompleted'),
  'orchestration.failed': t('orchestration.eventFailed'),
  'orchestration.aborted': t('orchestration.eventAborted'),
  'task.created': t('orchestration.eventTaskCreated'),
  'task.started': t('orchestration.eventTaskStarted'),
  'task.completed': t('orchestration.eventTaskCompleted'),
  'task.failed': t('orchestration.eventTaskFailed'),
  'task.cancelled': t('orchestration.eventTaskCancelled'),
  'handoff.created': t('orchestration.eventHandoff'),
  'agent.created': t('orchestration.eventAgentCreated'),
  'agent.deleted': t('orchestration.eventAgentDeleted')
}
</script>

<template>
  <section v-if="!orch" class="harness-card" data-testid="orchestration-dashboard-empty">
    <p class="text-[12px] text-[var(--text-tertiary)]">{{ t('orchestration.selectOrCreate') }}</p>
  </section>
  <div v-else class="space-y-4">
    <section class="harness-card" data-testid="orchestration-dashboard">
      <h3 class="harness-card-title">{{ t('orchestration.dashboardStatus') }}</h3>
      <div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div
          class="harness-metric rounded-[var(--radius-sm)] border border-[var(--border-subtle)] p-2.5"
        >
          <span class="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">
            {{ t('orchestration.metricTasks') }}
          </span>
          <span class="text-[15px] font-semibold text-[var(--text-primary)]">
            {{ orch.successCount }}/{{
              (orch.successCount ?? 0) + (orch.failureCount ?? 0) ||
              (store.snapshot?.tasks.length ?? 0)
            }}
          </span>
        </div>
        <div
          class="harness-metric rounded-[var(--radius-sm)] border border-[var(--border-subtle)] p-2.5"
        >
          <span class="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">
            {{ t('orchestration.metricAgents') }}
          </span>
          <span class="text-[15px] font-semibold text-[var(--text-primary)]">
            {{ store.snapshot?.agents.length ?? 0 }}
          </span>
        </div>
        <div
          class="harness-metric rounded-[var(--radius-sm)] border border-[var(--border-subtle)] p-2.5"
        >
          <span class="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">
            {{ t('orchestration.metricTokens') }}
          </span>
          <span class="text-[15px] font-semibold text-[var(--text-primary)]">
            {{ fmtTokens(orch.totalTokens ?? 0) }}
          </span>
        </div>
        <div
          class="harness-metric rounded-[var(--radius-sm)] border border-[var(--border-subtle)] p-2.5"
        >
          <span class="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">
            {{ t('orchestration.metricCost') }}
          </span>
          <span class="text-[15px] font-semibold text-[var(--text-primary)]">
            {{ orch.estimatedCost === null ? '—' : `$${orch.estimatedCost.toFixed(2)}` }}
          </span>
        </div>
      </div>
      <p v-if="orch.pausedReason" class="mt-2 text-[11px] text-[var(--warning)]">
        {{ orch.pausedReason }}
      </p>
      <div v-if="budgetTokens !== null || budgetCost !== null" class="mt-3 space-y-1.5">
        <div v-if="budgetTokens !== null" class="flex items-center gap-2">
          <span class="w-20 text-[10px] text-[var(--text-tertiary)]">tokens</span>
          <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--bg-hover)]">
            <div
              class="h-full rounded-full transition-all"
              :class="budgetTokens > 90 ? 'bg-[var(--error)]' : 'bg-[var(--accent)]'"
              :style="{ width: `${budgetTokens}%` }"
            />
          </div>
          <span class="w-14 text-right text-[10px] text-[var(--text-tertiary)]">
            {{ budgetTokens.toFixed(0) }}%
          </span>
        </div>
        <div v-if="budgetCost !== null" class="flex items-center gap-2">
          <span class="w-20 text-[10px] text-[var(--text-tertiary)]">cost</span>
          <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--bg-hover)]">
            <div
              class="h-full rounded-full transition-all"
              :class="budgetCost > 90 ? 'bg-[var(--error)]' : 'bg-[var(--accent)]'"
              :style="{ width: `${budgetCost}%` }"
            />
          </div>
          <span class="w-14 text-right text-[10px] text-[var(--text-tertiary)]">
            {{ budgetCost.toFixed(0) }}%
          </span>
        </div>
      </div>
      <div v-if="taskStats.length" class="mt-3 flex flex-wrap gap-1.5">
        <span
          v-for="item in taskStats"
          :key="item.status"
          class="rounded-full border border-[var(--border-subtle)] px-2 py-0.5 text-[10px] text-[var(--text-tertiary)]"
        >
          {{ item.status }} · {{ item.count }}
        </span>
      </div>
      <p class="mt-2 text-[10.5px] text-[var(--text-tertiary)]">
        {{ t('orchestration.started') }}: {{ fmtTime(orch.startedAt) }} ·
        {{ t('orchestration.finished') }}: {{ fmtTime(orch.finishedAt) }}
      </p>
    </section>

    <section v-if="costShares.length" class="harness-card" data-testid="orchestration-cost-shares">
      <h3 class="harness-card-title">{{ t('orchestration.costShares') }}</h3>
      <div class="mt-3 space-y-1.5">
        <div
          v-for="share in costShares"
          :key="share.agentId"
          class="flex items-center gap-2 text-[11px]"
        >
          <span class="w-32 truncate text-[var(--text-secondary)]">{{ share.name }}</span>
          <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--bg-hover)]">
            <div
              class="h-full rounded-full bg-[var(--accent)]"
              :style="{ width: `${share.costPercent ?? 0}%` }"
            />
          </div>
          <span class="w-16 text-right text-[10px] text-[var(--text-tertiary)]">
            {{ (share.costPercent ?? 0).toFixed(0) }}% · {{ fmtTokens(share.totalTokens) }}
          </span>
          <span class="w-14 text-right text-[10px] text-[var(--text-tertiary)]">
            {{ share.estimatedCost === null ? '—' : `$${share.estimatedCost.toFixed(2)}` }}
          </span>
        </div>
      </div>
    </section>

    <section
      v-if="conflicts && conflicts.conflicts.length"
      class="harness-card"
      data-testid="orchestration-conflicts"
    >
      <h3 class="harness-card-title">{{ t('orchestration.conflicts') }}</h3>
      <ul class="mt-2 space-y-1">
        <li
          v-for="file in conflicts.conflicts"
          :key="file.path"
          class="flex items-center gap-2 text-[11px] text-[var(--warning)]"
        >
          <span class="font-mono">{{ file.path }}</span>
          <span class="text-[var(--text-tertiary)]">
            {{ file.agentIds.map((id) => agentName(id)).join(' · ') }}
          </span>
        </li>
      </ul>
    </section>

    <section v-if="evaluation" class="harness-card" data-testid="orchestration-evaluation">
      <h3 class="harness-card-title">{{ t('orchestration.evaluation') }}</h3>
      <div class="mt-2 text-[11px] text-[var(--text-secondary)]">
        <p>
          {{ t('orchestration.evaluationStatus') }}: {{ evaluation.status }} ·
          {{ t('orchestration.evaluationTasks') }}: {{ evaluation.tasksCompleted }}/{{
            evaluation.tasksTotal
          }}
          · {{ t('orchestration.evaluationFailures') }}: {{ evaluation.runsFailed }}
        </p>
        <ul v-if="evaluation.checks.length" class="mt-1.5 space-y-0.5">
          <li
            v-for="check in evaluation.checks"
            :key="check.id"
            class="flex items-center gap-2 text-[10.5px]"
            :class="{
              'text-[var(--success)]': check.status === 'passed',
              'text-[var(--warning)]': check.status === 'warning',
              'text-[var(--error)]': check.status === 'failed'
            }"
          >
            <span class="font-medium">{{ check.name }}</span>
            <span class="text-[var(--text-tertiary)]">{{ check.message }}</span>
          </li>
        </ul>
      </div>
    </section>

    <section class="harness-card" data-testid="orchestration-timeline">
      <h3 class="harness-card-title">{{ t('orchestration.timeline') }}</h3>
      <p v-if="!timeline.length" class="mt-2 text-[12px] text-[var(--text-tertiary)]">
        {{ t('orchestration.timelineEmpty') }}
      </p>
      <ol v-else class="mt-2 space-y-1">
        <li
          v-for="(event, index) in timeline"
          :key="`${event.timestamp}-${index}`"
          class="flex items-center gap-2 text-[11px]"
        >
          <span class="w-24 shrink-0 text-[10px] text-[var(--text-tertiary)]">
            {{ fmtTime(event.timestamp) }}
          </span>
          <span class="text-[var(--text-secondary)]">
            {{ eventLabel[event.type] ?? event.type }}
          </span>
        </li>
      </ol>
    </section>
  </div>
</template>

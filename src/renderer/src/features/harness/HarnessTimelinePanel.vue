<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { HarnessEvent } from '@shared/types/harness'

type TraceFilter = 'all' | 'runs' | 'tools' | 'policy' | 'system'

const props = defineProps<{ events: HarnessEvent[] }>()
const { t, locale } = useI18n()
const filter = ref<TraceFilter>('all')

const filters: Array<{ id: TraceFilter; labelKey: string }> = [
  { id: 'all', labelKey: 'workspace.harnessTraceFilterAll' },
  { id: 'runs', labelKey: 'workspace.harnessTraceFilterRuns' },
  { id: 'tools', labelKey: 'workspace.harnessTraceFilterTools' },
  { id: 'policy', labelKey: 'workspace.harnessTraceFilterPolicy' },
  { id: 'system', labelKey: 'workspace.harnessTraceFilterSystem' }
]

function category(event: HarnessEvent): Exclude<TraceFilter, 'all'> {
  if (
    event.type.startsWith('run.') ||
    event.type.startsWith('budget.') ||
    event.type.startsWith('artifact.') ||
    event.type.startsWith('baseline.')
  )
    return 'runs'
  if (event.type.startsWith('tool.') || event.type.startsWith('compaction.')) return 'tools'
  if (event.type.startsWith('policy.') || event.type.startsWith('evaluation.')) return 'policy'
  return 'system'
}

const ordered = computed(() =>
  [...props.events]
    .reverse()
    .filter((event) => filter.value === 'all' || category(event) === filter.value)
)

function time(timestamp: number): string {
  return new Intl.DateTimeFormat(locale.value, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(timestamp)
}

function label(event: HarnessEvent): string {
  switch (event.type) {
    case 'session.started':
      return t('workspace.harnessEventSessionStarted')
    case 'session.stopped':
      return t('workspace.harnessEventSessionStopped')
    case 'runtime.started':
      return t('workspace.harnessEventRuntimeStarted')
    case 'runtime.idle':
      return t('workspace.harnessEventRuntimeIdle')
    case 'runtime.aborted':
      return t('workspace.harnessEventRuntimeAborted')
    case 'prompt.started':
      return event.message
        ? t('workspace.harnessEventPromptStartedWith', { prompt: event.message })
        : t('workspace.harnessEventPromptStarted')
    case 'prompt.completed':
      return t('workspace.harnessEventPromptCompleted')
    case 'message.started':
      return t('workspace.harnessEventMessageStarted')
    case 'message.completed': {
      const usage = event.usage
      if (!usage) return t('workspace.harnessEventMessageCompleted')
      const cost = usage.cost === null ? '' : ` · $${usage.cost.toFixed(4)}`
      return t('workspace.harnessEventMessageUsage', {
        tokens: usage.total.toLocaleString(),
        cost
      })
    }
    case 'tool.started':
      return t('workspace.harnessEventToolStarted', { tool: event.toolName })
    case 'tool.completed':
      return event.isError
        ? t('workspace.harnessEventToolFailed', { tool: event.toolName })
        : t('workspace.harnessEventToolCompleted', { tool: event.toolName })
    case 'thinking.changed':
      return t('workspace.harnessEventThinking', { level: event.level })
    case 'model.changed':
      return t('workspace.harnessEventModel', { model: `${event.provider}/${event.modelId}` })
    case 'tools.changed':
      return t('workspace.harnessEventTools', { count: event.active })
    case 'queue.changed':
      return t('workspace.harnessEventQueue', {
        steering: event.steering,
        followUp: event.followUp
      })
    case 'context.updated':
      return t('workspace.harnessEventContext', {
        percent: event.percent === null ? '—' : `${event.percent.toFixed(1)}%`
      })
    case 'runtime.error':
      return t('workspace.harnessEventError', { message: event.message })
    case 'session.forked':
      return t('workspace.harnessEventForked', { id: event.newSessionId })
    case 'session.navigated':
      return t('workspace.harnessEventNavigated', { id: event.targetId })
    case 'autoCompaction.changed':
      return t('workspace.harnessEventAutoCompaction', { enabled: event.enabled ? 'ON' : 'OFF' })
    case 'compaction.skipped':
      return t('workspace.harnessEventCompactionSkipped', { reason: event.reason })
    case 'compaction.started':
      return t('workspace.harnessEventCompactionStarted')
    case 'compaction.completed':
      return t('workspace.harnessEventCompactionCompleted')
    case 'steering.queued':
      return t('workspace.harnessEventSteeringQueued')
    case 'followUp.queued':
      return t('workspace.harnessEventFollowUpQueued')
    case 'run.started':
      return t('workspace.harnessEventRunStarted', { prompt: event.prompt })
    case 'run.completed':
      return t('workspace.harnessEventRunCompleted', { status: event.status })
    case 'run.failed':
      return t('workspace.harnessEventRunFailed', { error: event.error ?? '' })
    case 'run.aborted':
      return t('workspace.harnessEventRunAborted')
    case 'checkpoint.created':
      return t('workspace.harnessEventCheckpointCreated', { reason: event.reason })
    case 'policy.allowed':
      return t('workspace.harnessEventPolicyAllowed', { target: event.target })
    case 'policy.denied':
      return t('workspace.harnessEventPolicyDenied', { target: event.target, rule: event.rule })
    case 'policy.confirmed':
      return t(
        event.allowed
          ? 'workspace.harnessEventPolicyConfirmed'
          : 'workspace.harnessEventPolicyRejected',
        { target: event.target }
      )
    case 'budget.exceeded':
      return t('workspace.harnessEventBudgetExceeded', { limit: event.limit, value: event.value })
    case 'evaluation.started':
      return t('workspace.harnessEventEvaluationStarted')
    case 'evaluation.completed':
      return t('workspace.harnessEventEvaluationCompleted', { status: event.status })
    case 'recovery.started':
      return t('workspace.harnessEventRecoveryStarted', { kind: event.kind })
    case 'recovery.completed':
      return t('workspace.harnessEventRecoveryCompleted', { kind: event.kind })
    case 'run.forked':
      return t('workspace.harnessEventRunForked')
    case 'artifact.recorded':
      return t('workspace.harnessEventArtifactRecorded', { type: event.artifactType })
    case 'baseline.changed':
      return t('workspace.harnessEventBaselineChanged')
    default: {
      // Orchestration-scoped events (orchestration.* / agent.* / task.* /
      // handoff.* / review.*) are labelled by the Orchestration panel; the
      // session timeline still renders them with a readable type tag.
      return event.type
    }
  }
}

function tone(event: HarnessEvent): string {
  const kind = category(event)
  if (
    event.type === 'runtime.error' ||
    event.type === 'run.failed' ||
    event.type === 'budget.exceeded'
  )
    return 'bg-[var(--error)]'
  if (event.type === 'policy.denied') return 'bg-[var(--warning)]'
  if (kind === 'runs') return 'bg-[var(--success)]'
  if (kind === 'policy') return 'bg-[var(--warning)]'
  return 'bg-[var(--accent)]'
}
</script>

<template>
  <section class="harness-card max-w-4xl" data-testid="harness-trace-panel">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h3 class="harness-card-title">{{ $t('workspace.harnessTimeline') }}</h3>
      <div class="flex gap-1" role="group" :aria-label="$t('workspace.harnessTraceFilters')">
        <button
          v-for="item in filters"
          :key="item.id"
          type="button"
          class="rounded-[var(--radius-sm)] border px-1.5 py-0.5 text-[10px] transition-colors"
          :class="
            filter === item.id
              ? 'border-[var(--accent-border)] bg-[var(--accent-tint)] text-[var(--accent)]'
              : 'border-transparent text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]'
          "
          :aria-pressed="filter === item.id"
          @click="filter = item.id"
        >
          {{ $t(item.labelKey) }}
        </button>
      </div>
    </div>
    <ol v-if="ordered.length" class="mt-3 space-y-0">
      <li
        v-for="(event, index) in ordered"
        :key="`${event.timestamp}:${event.type}:${index}`"
        class="relative grid grid-cols-[74px_14px_1fr] gap-2 pb-3 text-[11.5px]"
      >
        <time class="pt-0.5 font-mono text-[var(--text-tertiary)]">{{
          time(event.timestamp)
        }}</time>
        <span class="relative flex justify-center">
          <span class="mt-1.5 size-2 rounded-full" :class="tone(event)" />
          <span
            v-if="index < ordered.length - 1"
            class="absolute bottom-[-12px] top-3 w-px bg-[var(--border-subtle)]"
          />
        </span>
        <p
          class="rounded-[var(--radius-sm)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-[var(--text-secondary)]"
        >
          {{ label(event) }}
        </p>
      </li>
    </ol>
    <p v-else class="mt-4 text-[12px] text-[var(--text-tertiary)]">
      {{ $t('workspace.harnessNoEvents') }}
    </p>
  </section>
</template>

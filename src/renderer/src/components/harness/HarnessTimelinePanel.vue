<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { HarnessEvent } from '@shared/types/harness'

const props = defineProps<{ events: HarnessEvent[] }>()
const { t, locale } = useI18n()
const ordered = computed(() => [...props.events].reverse())

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
      return t('workspace.harnessEventPromptStarted')
    case 'prompt.completed':
      return t('workspace.harnessEventPromptCompleted')
    case 'tool.started':
      return t('workspace.harnessEventToolStarted', { tool: event.toolName })
    case 'tool.completed':
      return t('workspace.harnessEventToolCompleted', { tool: event.toolName })
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
  }
}
</script>

<template>
  <section class="harness-card max-w-4xl">
    <div class="flex items-center justify-between">
      <h3 class="harness-card-title">{{ $t('workspace.harnessTimeline') }}</h3>
      <span class="text-[10.5px] text-[var(--text-tertiary)]">
        {{ $t('workspace.harnessLiveEvents') }}
      </span>
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
          <span class="mt-1.5 size-2 rounded-full bg-[var(--accent)]" />
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

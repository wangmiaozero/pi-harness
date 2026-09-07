<script setup lang="ts">
import { computed } from 'vue'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import type { HarnessSessionInfo, HarnessState } from '@shared/types/harness'
import { layoutSessionTree } from '@shared/workspace/session-graph'
import { useHarnessStore } from '@renderer/stores/harness'
import { useAgentStore } from '@renderer/stores/agent'
import { useSessionStore } from '@renderer/stores/sessions'
import { useWorkspaceStore } from '@renderer/stores/workspace'

const props = defineProps<{ state: HarnessState; session: HarnessSessionInfo }>()
const harness = useHarnessStore()
const agent = useAgentStore()
const sessions = useSessionStore()
const workspace = useWorkspaceStore()
const { t } = useI18n()

const rows = computed(() => layoutSessionTree(props.session.entries))
const laneWidth = 17
const graphWidth = computed(() =>
  Math.max(24, Math.max(1, ...rows.value.map((row) => row.laneCount)) * laneWidth + 6)
)
const colors = [
  'var(--accent)',
  'var(--success)',
  'var(--warning)',
  '#7c6ee6',
  '#2fa5a0',
  '#d06b8b',
  '#7aa35a',
  '#c77d45'
]

function x(lane: number): number {
  return 5 + (lane + 0.5) * laneWidth
}

function color(index: number): string {
  return colors[index % colors.length]!
}

function entryTime(entry: { timestamp?: string }): string {
  if (!entry.timestamp) return ''
  const parsed = new Date(entry.timestamp)
  if (Number.isNaN(parsed.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit'
  }).format(parsed)
}

async function navigate(entryId: string) {
  try {
    await harness.navigateTree(entryId)
    await agent.load(props.session.sessionId)
    await harness.load(props.session.sessionId)
    toast.success(t('workspace.harnessNavigated'))
  } catch {
    /* Store exposes the sanitized error. */
  }
}

async function fork(entryId: string) {
  try {
    const result = await harness.fork(entryId)
    if (!result.newSessionId) return
    await sessions.refresh(true)
    const created = sessions.items.find((item) => item.id === result.newSessionId)
    sessions.selectSession(result.newSessionId)
    workspace.ensureChatTab(
      result.newSessionId,
      created?.name || created?.firstMessage?.slice(0, 32) || result.newSessionId
    )
    toast.success(t('workspace.harnessForked'))
  } catch {
    /* Store exposes the sanitized error. */
  }
}
</script>

<template>
  <section class="harness-card max-w-5xl">
    <h3 class="harness-card-title">{{ $t('workspace.harnessSession') }}</h3>
    <dl class="mt-3 grid grid-cols-[100px_1fr] gap-2 text-[12px]">
      <dt class="text-[var(--text-tertiary)]">{{ $t('workspace.sessionName') }}</dt>
      <dd class="text-[var(--text-primary)]">{{ session.name || '—' }}</dd>
      <dt class="text-[var(--text-tertiary)]">{{ $t('workspace.sessionId') }}</dt>
      <dd class="truncate font-mono text-[var(--text-primary)]">{{ session.sessionId }}</dd>
      <dt class="text-[var(--text-tertiary)]">{{ $t('workspace.harnessLeaf') }}</dt>
      <dd class="truncate font-mono text-[var(--text-primary)]">{{ session.leafId || '—' }}</dd>
    </dl>

    <div
      v-if="rows.length"
      class="mt-4 overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border-subtle)]"
    >
      <div
        v-for="row in rows"
        :key="row.entry.id"
        class="flex h-10 min-w-0 items-center gap-2 border-b border-[var(--border-subtle)] px-2 last:border-b-0"
        :class="row.entry.active ? 'bg-[var(--accent-tint)]' : 'bg-[var(--bg-surface)]'"
      >
        <svg
          class="h-10 shrink-0"
          :style="{ width: `${graphWidth}px` }"
          :viewBox="`0 0 ${graphWidth} 40`"
          aria-hidden="true"
        >
          <line
            v-for="edge in row.passThrough"
            :key="`pass-${edge.lane}`"
            :x1="x(edge.lane)"
            y1="0"
            :x2="x(edge.lane)"
            y2="40"
            :stroke="color(edge.color)"
            stroke-width="1.7"
          />
          <path
            v-for="edge in row.inboundLanes"
            :key="`in-${edge.lane}`"
            :d="`M ${x(edge.lane)} 0 C ${x(edge.lane)} 11, ${x(row.column)} 10, ${x(row.column)} 20`"
            fill="none"
            :stroke="color(edge.color)"
            stroke-width="1.7"
          />
          <path
            v-for="edge in row.childLanes"
            :key="`out-${edge.lane}`"
            :d="`M ${x(row.column)} 20 C ${x(row.column)} 30, ${x(edge.lane)} 29, ${x(edge.lane)} 40`"
            fill="none"
            :stroke="color(edge.color)"
            stroke-width="1.7"
          />
          <circle
            :cx="x(row.column)"
            cy="20"
            r="4.5"
            :fill="color(row.columnColor)"
            stroke="var(--bg-surface)"
            stroke-width="2"
          />
        </svg>

        <span class="w-24 shrink-0 text-[10.5px] text-[var(--text-tertiary)]">
          {{ row.entry.role || row.entry.type }}
        </span>
        <span
          class="min-w-0 flex-1 truncate font-mono text-[10.5px]"
          :class="row.entry.active ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'"
          :title="row.entry.label || row.entry.id"
        >
          {{ row.entry.label || row.entry.id }}
        </span>
        <span
          v-if="entryTime(row.entry)"
          class="w-12 shrink-0 text-right text-[9.5px] text-[var(--text-tertiary)]"
        >
          {{ entryTime(row.entry) }}
        </span>
        <button
          type="button"
          class="harness-inline-button"
          :disabled="
            harness.mutating || !state.capabilities.sessionTree || row.entry.id === session.leafId
          "
          @click="navigate(row.entry.id)"
        >
          {{ $t('workspace.harnessNavigate') }}
        </button>
        <button
          v-if="row.entry.type === 'message' && row.entry.role === 'user'"
          type="button"
          class="harness-inline-button"
          :disabled="harness.mutating || !state.capabilities.sessionFork"
          @click="fork(row.entry.id)"
        >
          {{ $t('workspace.harnessFork') }}
        </button>
      </div>
    </div>
    <p v-else class="mt-4 text-[12px] text-[var(--text-tertiary)]">
      {{ $t('workspace.harnessTreeUnavailable') }}
    </p>
  </section>
</template>

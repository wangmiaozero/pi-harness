<script setup lang="ts">
import { computed } from 'vue'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import type { HarnessSessionInfo, HarnessState } from '@shared/types/harness'
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

const rows = computed(() =>
  props.session.entries.map((entry) => ({ ...entry, depth: depthOf(entry.id) }))
)

function depthOf(id: string): number {
  const byId = new Map(props.session.entries.map((entry) => [entry.id, entry]))
  const seen = new Set<string>()
  let current = byId.get(id)
  let depth = 0
  while (current?.parentId && depth < 20 && !seen.has(current.parentId)) {
    seen.add(current.parentId)
    current = byId.get(current.parentId)
    depth += 1
  }
  return depth
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
        v-for="entry in rows"
        :key="entry.id"
        class="flex min-h-9 items-center gap-2 border-b border-[var(--border-subtle)] px-2 last:border-b-0"
        :class="entry.active ? 'bg-[var(--accent-tint)]' : 'bg-[var(--bg-surface)]'"
      >
        <span :style="{ width: `${entry.depth * 12}px` }" class="shrink-0" />
        <span
          class="size-1.5 shrink-0 rounded-full"
          :class="entry.active ? 'bg-[var(--accent)]' : 'bg-[var(--text-disabled)]'"
        />
        <span class="w-24 shrink-0 text-[10.5px] text-[var(--text-tertiary)]">
          {{ entry.role || entry.type }}
        </span>
        <span class="min-w-0 flex-1 truncate font-mono text-[10.5px] text-[var(--text-secondary)]">
          {{ entry.label || entry.id }}
        </span>
        <button
          type="button"
          class="harness-inline-button"
          :disabled="
            harness.mutating || !state.capabilities.sessionTree || entry.id === session.leafId
          "
          @click="navigate(entry.id)"
        >
          {{ $t('workspace.harnessNavigate') }}
        </button>
        <button
          v-if="entry.type === 'message' && entry.role === 'user'"
          type="button"
          class="harness-inline-button"
          :disabled="harness.mutating || !state.capabilities.sessionFork"
          @click="fork(entry.id)"
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

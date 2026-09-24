<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Bot, Pause, Play, Plus, RefreshCw, Square, Trash2 } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import EmptyState from '@renderer/components/ui/EmptyState.vue'
import IconButton from '@renderer/components/ui/IconButton.vue'
import Select from '@renderer/components/ui/Select.vue'
import OrchestrationDashboard from './OrchestrationDashboard.vue'
import OrchestrationAgentsPanel from './OrchestrationAgentsPanel.vue'
import OrchestrationTasksPanel from './OrchestrationTasksPanel.vue'
import OrchestrationPresetsPanel from './OrchestrationPresetsPanel.vue'
import OrchestrationDraftDialog from './OrchestrationDraftDialog.vue'
import { useOrchestrationStore } from '@renderer/stores/orchestration'

type Section = 'dashboard' | 'agents' | 'tasks' | 'presets'

const { t } = useI18n()
const store = useOrchestrationStore()
const section = ref<Section>('dashboard')
const showDraft = ref(false)
let cleanup: (() => void) | null = null

const sections = computed<Array<{ id: Section; label: string }>>(() => [
  { id: 'dashboard', label: t('orchestration.sectionDashboard') },
  { id: 'agents', label: t('orchestration.sectionAgents') },
  { id: 'tasks', label: t('orchestration.sectionTasks') },
  { id: 'presets', label: t('orchestration.sectionPresets') }
])

const orchestrationOptions = computed(() =>
  store.orchestrations.length
    ? store.orchestrations.map((item) => ({
        value: item.id,
        label: `${item.name ?? item.id.slice(0, 8)} · ${item.status}`
      }))
    : [{ value: '', label: t('orchestration.noneYet') }]
)

const statusTone: Record<string, string> = {
  pending: 'text-[var(--text-tertiary)]',
  running: 'text-[var(--success)]',
  paused: 'text-[var(--warning)]',
  completed: 'text-[var(--success)]',
  failed: 'text-[var(--error)]',
  aborted: 'text-[var(--text-tertiary)]'
}

onMounted(() => {
  cleanup = store.setupListeners()
  void store.load()
})

onBeforeUnmount(() => {
  cleanup?.()
  cleanup = null
})

async function removeCurrent(): Promise<void> {
  const id = store.currentId
  if (!id) return
  store.deleteOrchestration(id)
}

async function toggleRun(): Promise<void> {
  const status = store.snapshot?.orchestration.status
  if (status === 'running') await store.pause()
  else if (status === 'paused' || status === 'pending') await store.start()
}
</script>

<template>
  <div
    data-testid="orchestration-console"
    class="flex h-full min-h-0 flex-col bg-[var(--bg-workspace)]"
  >
    <header
      class="flex min-h-14 shrink-0 items-center gap-3 border-b border-[var(--border-subtle)] px-5"
    >
      <div class="flex min-w-0 flex-1 items-center gap-2.5">
        <Bot class="size-4 text-[var(--accent)]" />
        <div class="min-w-0">
          <h2
            class="text-[13px] font-semibold uppercase tracking-[0.09em] text-[var(--text-primary)]"
          >
            {{ $t('orchestration.title') }}
          </h2>
          <p class="truncate text-[10.5px] text-[var(--text-tertiary)]">
            {{ $t('orchestration.subtitle') }}
          </p>
        </div>
      </div>
      <IconButton :label="$t('common.refresh')" :disabled="store.loading" @click="store.load">
        <RefreshCw class="size-3.5" :class="store.loading ? 'animate-spin' : ''" />
      </IconButton>
    </header>

    <div class="flex shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-2">
      <Select
        :model-value="store.currentId ?? ''"
        :options="orchestrationOptions"
        class="max-w-[240px] min-w-0"
        size="sm"
        data-testid="orchestration-select"
        @update:model-value="store.select($event || null)"
      />
      <button
        type="button"
        class="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--accent-border)] bg-[var(--accent-tint)] px-2 py-1 text-[11px] text-[var(--accent)] transition-colors hover:brightness-95"
        data-testid="orchestration-create"
        @click="showDraft = true"
      >
        <Plus class="size-3" />
        {{ $t('orchestration.newRun') }}
      </button>
      <template v-if="store.current">
        <button
          type="button"
          class="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50"
          :disabled="
            store.mutating || !['pending', 'paused', 'running'].includes(store.current.status)
          "
          :title="$t('orchestration.toggleRunHint')"
          @click="toggleRun"
        >
          <Play v-if="store.current.status !== 'running'" class="size-3" />
          <Pause v-else class="size-3" />
          {{
            store.current.status === 'running'
              ? $t('orchestration.pause')
              : $t('orchestration.start')
          }}
        </button>
        <button
          type="button"
          class="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 py-1 text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50"
          :disabled="store.mutating || !['paused', 'running'].includes(store.current.status)"
          @click="store.abort()"
        >
          <Square class="size-3" />
          {{ $t('orchestration.abort') }}
        </button>
        <button
          type="button"
          class="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 py-1 text-[11px] text-[var(--error)] transition-colors hover:bg-[var(--bg-hover)] disabled:opacity-50"
          :disabled="
            store.mutating ||
            !['pending', 'paused', 'failed', 'aborted', 'completed'].includes(store.current.status)
          "
          :title="$t('orchestration.deleteHint')"
          data-testid="orchestration-delete"
          @click="removeCurrent"
        >
          <Trash2 class="size-3" />
          {{ $t('orchestration.delete') }}
        </button>
        <span
          class="rounded-full border border-[var(--border-subtle)] px-2 py-0.5 text-[10px] uppercase tracking-wide"
          :class="statusTone[store.current.status]"
          data-testid="orchestration-status"
        >
          {{ store.current.status }}
        </span>
      </template>
    </div>

    <nav
      class="flex shrink-0 gap-1 overflow-x-auto border-b border-[var(--border-subtle)] px-4 py-1.5"
      :aria-label="$t('orchestration.sections')"
    >
      <button
        v-for="item in sections"
        :key="item.id"
        type="button"
        class="rounded-[var(--radius-sm)] border px-2.5 py-1 text-[11px] transition-colors focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
        :class="
          section === item.id
            ? 'border-[var(--accent-border)] bg-[var(--bg-surface-raised)] text-[var(--text-primary)] shadow-[inset_0_-2px_0_var(--accent)]'
            : 'border-transparent text-[var(--text-tertiary)] hover:border-[var(--border-default)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
        "
        :aria-pressed="section === item.id"
        @click="section = item.id"
      >
        {{ item.label }}
      </button>
    </nav>

    <div class="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
      <div
        v-if="store.error"
        role="alert"
        class="mb-3 rounded-[var(--radius-sm)] border border-[var(--error)] bg-[var(--error-tint)] px-3 py-2 text-[11.5px] text-[var(--error)]"
      >
        {{ store.error }}
      </div>
      <OrchestrationDashboard v-if="section === 'dashboard'" />
      <OrchestrationAgentsPanel v-else-if="section === 'agents'" />
      <OrchestrationTasksPanel v-else-if="section === 'tasks'" />
      <OrchestrationPresetsPanel v-else />
      <EmptyState
        v-if="!store.orchestrations.length"
        class="hidden"
        :icon="Bot"
        :title="$t('orchestration.noneYet')"
        :description="$t('orchestration.noneYetHint')"
      />
    </div>

    <OrchestrationDraftDialog v-if="showDraft" @close="showDraft = false" />
  </div>
</template>

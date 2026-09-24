<script setup lang="ts">
import { computed } from 'vue'
import { ArrowLeft, History } from '@lucide/vue'
import IconButton from '@renderer/components/ui/IconButton.vue'
import type { GitCommitInfo } from '@shared/types/workspace'

/**
 * Overlay drawer listing the commits that touched one file, drawn over the
 * graph pane — the pane below keeps its state (scroll position, selection)
 * while this is open.
 */
const props = withDefaults(
  defineProps<{
    filePath: string
    commits: GitCommitInfo[]
    loading?: boolean
    limit?: number
  }>(),
  { loading: false, limit: 100 }
)

const emit = defineEmits<{
  close: []
  'select-commit': [commit: GitCommitInfo]
}>()

const truncated = computed(() => props.commits.length >= props.limit)

function date(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    year: '2-digit',
    month: '2-digit',
    day: '2-digit'
  }).format(parsed)
}

function refs(commit: GitCommitInfo): string {
  return commit.refs.map((ref) => ref.replace(/^HEAD -> /, '').replace(/^tag: /, '')).join(', ')
}
</script>

<template>
  <section
    class="absolute inset-0 z-20 flex min-h-0 min-w-0 flex-col bg-[var(--bg-surface)]"
    data-testid="git-file-history"
  >
    <header
      class="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface-raised)] px-2"
    >
      <IconButton
        :label="$t('workspace.gitBackToGraph')"
        data-testid="git-back-to-graph"
        @click="emit('close')"
      >
        <ArrowLeft class="size-3.5" />
      </IconButton>
      <History class="size-3.5 shrink-0 text-[var(--accent)]" />
      <span class="min-w-0 flex-1 truncate text-[10.5px] font-medium text-[var(--text-primary)]">
        {{ $t('workspace.gitFileHistoryTitle', { file: filePath }) }}
      </span>
      <span class="shrink-0 text-[9.5px] text-[var(--text-tertiary)]">{{ commits.length }}</span>
    </header>

    <div
      v-if="loading"
      class="flex min-h-0 flex-1 items-center justify-center text-[10.5px] text-[var(--text-tertiary)]"
    >
      {{ $t('common.loading') }}
    </div>
    <div
      v-else-if="!commits.length"
      class="flex min-h-0 flex-1 items-center justify-center text-[10.5px] text-[var(--text-disabled)]"
    >
      {{ $t('workspace.gitNoCommits') }}
    </div>
    <div v-else class="min-h-0 flex-1 overflow-y-auto">
      <button
        v-for="commit in commits"
        :key="commit.hash"
        type="button"
        class="flex h-10 min-w-0 w-full items-center gap-2 border-b border-[var(--border-subtle)] px-3 text-left transition-colors hover:bg-[var(--bg-hover)]"
        @click="emit('select-commit', commit)"
      >
        <code
          class="shrink-0 font-[family-name:var(--font-mono)] text-[9.5px] text-[var(--text-tertiary)]"
        >
          {{ commit.hash.slice(0, 7) }}
        </code>
        <span class="min-w-0 flex-1 truncate text-[11px] text-[var(--text-primary)]">
          {{ commit.subject }}
        </span>
        <span
          v-if="refs(commit)"
          class="hidden max-w-40 shrink-0 truncate text-[9px] text-[var(--accent)] sm:inline"
        >
          {{ refs(commit) }}
        </span>
        <span class="shrink-0 text-[9.5px] text-[var(--text-tertiary)]">
          {{ commit.author }}
        </span>
        <time
          class="shrink-0 text-[9.5px] text-[var(--text-tertiary)]"
          :datetime="commit.authoredAt"
        >
          {{ date(commit.authoredAt) }}
        </time>
      </button>
      <p v-if="truncated" class="px-3 py-2 text-[10px] text-[var(--text-tertiary)]">
        {{ $t('workspace.gitFileHistoryTruncated', { limit }) }}
      </p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { GitCommitInfo } from '@shared/types/workspace'
import { layoutGitGraph } from '@shared/workspace/git-graph'
import EmptyState from '@renderer/components/ui/EmptyState.vue'
import { GitBranch } from '@lucide/vue'

interface RefSelection {
  name: string
  hash: string
}

const props = withDefaults(
  defineProps<{
    commits: GitCommitInfo[]
    loading?: boolean
    selectedHash?: string | null
    activeRef?: string | null
  }>(),
  { loading: false, selectedHash: null, activeRef: null }
)
const emit = defineEmits<{
  select: [commit: GitCommitInfo]
  'select-ref': [selection: RefSelection]
}>()

const rows = computed(() => layoutGitGraph(props.commits))
const maxLanes = computed(() => Math.max(1, ...rows.value.map((row) => row.laneCount)))
const laneWidth = computed(() => Math.max(8, Math.min(17, 136 / maxLanes.value)))
const graphWidth = computed(() => Math.max(28, Math.min(140, maxLanes.value * laneWidth.value + 6)))
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
  return 5 + (lane + 0.5) * laneWidth.value
}

function color(index: number): string {
  return colors[index % colors.length]!
}

function shortRef(ref: string): string {
  return ref.replace(/^HEAD -> /, '').replace(/^tag: /, '')
}

function date(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    year: '2-digit',
    month: '2-digit',
    day: '2-digit'
  }).format(parsed)
}
</script>

<template>
  <div class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-[var(--bg-surface)]">
    <div v-if="loading" class="space-y-1 p-3" aria-label="Loading git history">
      <div
        v-for="index in 9"
        :key="index"
        class="h-10 animate-pulse rounded-[var(--radius-sm)] bg-[var(--bg-hover)]"
      />
    </div>
    <EmptyState
      v-else-if="!rows.length"
      :title="$t('workspace.gitNoCommits')"
      :description="$t('workspace.gitNoCommitsHint')"
      :icon="GitBranch"
    />
    <div v-else data-testid="git-history-graph">
      <div
        v-for="row in rows"
        :key="row.commit.hash"
        role="button"
        tabindex="0"
        class="group flex h-10 min-w-0 cursor-pointer items-center border-b border-[var(--border-subtle)] px-3 outline-none transition-colors hover:bg-[var(--bg-hover)] focus-visible:shadow-[inset_0_0_0_1px_var(--accent)]"
        :class="
          selectedHash === row.commit.hash
            ? 'bg-[var(--bg-selected)] shadow-[inset_2px_0_0_var(--accent)]'
            : ''
        "
        :aria-pressed="selectedHash === row.commit.hash"
        :data-commit-hash="row.commit.hash"
        @click="emit('select', row.commit)"
        @keydown.enter.prevent="emit('select', row.commit)"
        @keydown.space.prevent="emit('select', row.commit)"
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
            v-for="edge in row.mergeSources"
            :key="`merge-${edge.lane}`"
            :d="`M ${x(edge.lane)} 0 C ${x(edge.lane)} 11, ${x(row.column)} 10, ${x(row.column)} 20`"
            fill="none"
            :stroke="color(edge.color)"
            stroke-width="1.7"
          />
          <path
            v-for="edge in row.parentLanes"
            :key="`parent-${edge.lane}`"
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

        <div class="git-row-grid grid min-w-0 flex-1 items-center gap-3">
          <span class="truncate text-[11.5px] text-[var(--text-primary)]">
            {{ row.commit.subject }}
          </span>
          <span class="git-ref-column flex min-w-0 max-w-[380px] items-center justify-end gap-1">
            <button
              v-for="ref in row.commit.refs.slice(0, 4)"
              :key="ref"
              type="button"
              class="max-w-32 shrink-0 truncate rounded-full border px-1.5 py-0.5 text-[9px] transition-colors"
              :class="
                activeRef === shortRef(ref)
                  ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                  : 'border-[var(--accent-border)] bg-[var(--accent-tint)] text-[var(--accent)] hover:bg-[var(--accent-tint-strong)]'
              "
              :title="$t('workspace.gitFilterRefHint', { ref: shortRef(ref) })"
              :data-git-ref="shortRef(ref)"
              @click.stop="emit('select-ref', { name: shortRef(ref), hash: row.commit.hash })"
            >
              {{ shortRef(ref) }}
            </button>
          </span>
          <span
            class="font-[family-name:var(--font-mono)] text-[9.5px] text-[var(--text-tertiary)]"
          >
            {{ row.commit.hash.slice(0, 7) }}
          </span>
          <span class="git-author-column truncate text-[9.5px] text-[var(--text-tertiary)]">
            {{ row.commit.author }}
          </span>
          <time
            class="git-date-column text-right text-[9.5px] text-[var(--text-tertiary)]"
            :datetime="row.commit.authoredAt"
          >
            {{ date(row.commit.authoredAt) }}
          </time>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.git-row-grid {
  grid-template-columns: minmax(180px, 1fr) auto 64px 110px 64px;
}

@container (max-width: 850px) {
  .git-row-grid {
    grid-template-columns: minmax(150px, 1fr) auto 64px 64px;
  }

  .git-author-column {
    display: none;
  }

  .git-ref-column {
    max-width: 220px;
  }
}

@container (max-width: 620px) {
  .git-row-grid {
    grid-template-columns: minmax(120px, 1fr) 64px;
  }

  .git-ref-column,
  .git-date-column {
    display: none;
  }
}
</style>

<script setup lang="ts">
import { computed } from 'vue'
import type { GitCommitInfo } from '@shared/types/workspace'
import { layoutGitGraph } from '@shared/workspace/git-graph'
import EmptyState from '@renderer/components/ui/EmptyState.vue'
import { GitBranch } from '@lucide/vue'

const props = withDefaults(
  defineProps<{
    commits: GitCommitInfo[]
    loading?: boolean
  }>(),
  { loading: false }
)

const rows = computed(() => layoutGitGraph(props.commits))
const maxLanes = computed(() => Math.max(1, ...rows.value.map((row) => row.laneCount)))
const laneWidth = computed(() => Math.max(7, Math.min(16, 112 / maxLanes.value)))
const graphWidth = computed(() => Math.max(24, Math.min(116, maxLanes.value * laneWidth.value + 4)))
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
  return 4 + (lane + 0.5) * laneWidth.value
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
  return new Intl.DateTimeFormat(undefined, { month: '2-digit', day: '2-digit' }).format(parsed)
}
</script>

<template>
  <div class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
    <div v-if="loading" class="space-y-1 p-3" aria-label="Loading git history">
      <div
        v-for="index in 7"
        :key="index"
        class="h-8 animate-pulse rounded-[var(--radius-sm)] bg-[var(--bg-hover)]"
      />
    </div>
    <EmptyState
      v-else-if="!rows.length"
      :title="$t('workspace.gitNoCommits')"
      :description="$t('workspace.gitNoCommitsHint')"
      :icon="GitBranch"
    />
    <div v-else class="py-1" data-testid="git-history-graph">
      <div
        v-for="row in rows"
        :key="row.commit.hash"
        class="group flex h-9 min-w-0 items-center border-b border-[var(--border-subtle)]/70 px-2 hover:bg-[var(--bg-hover)]"
      >
        <svg
          class="h-9 shrink-0"
          :style="{ width: `${graphWidth}px` }"
          :viewBox="`0 0 ${graphWidth} 36`"
          aria-hidden="true"
        >
          <line
            v-for="edge in row.passThrough"
            :key="`pass-${edge.lane}`"
            :x1="x(edge.lane)"
            y1="0"
            :x2="x(edge.lane)"
            y2="36"
            :stroke="color(edge.color)"
            stroke-width="1.5"
          />
          <path
            v-for="edge in row.mergeSources"
            :key="`merge-${edge.lane}`"
            :d="`M ${x(edge.lane)} 0 C ${x(edge.lane)} 10, ${x(row.column)} 9, ${x(row.column)} 18`"
            fill="none"
            :stroke="color(edge.color)"
            stroke-width="1.5"
          />
          <path
            v-for="edge in row.parentLanes"
            :key="`parent-${edge.lane}`"
            :d="`M ${x(row.column)} 18 C ${x(row.column)} 27, ${x(edge.lane)} 26, ${x(edge.lane)} 36`"
            fill="none"
            :stroke="color(edge.color)"
            stroke-width="1.5"
          />
          <circle
            :cx="x(row.column)"
            cy="18"
            r="4"
            :fill="color(row.columnColor)"
            stroke="var(--bg-base)"
            stroke-width="2"
          />
        </svg>
        <div class="min-w-0 flex-1">
          <div class="flex min-w-0 items-center gap-1.5">
            <span class="min-w-0 flex-1 truncate text-[11.5px] text-[var(--text-primary)]">
              {{ row.commit.subject }}
            </span>
            <span
              v-for="ref in row.commit.refs.slice(0, 2)"
              :key="ref"
              class="max-w-24 shrink-0 truncate rounded-full border border-[var(--accent-border)] bg-[var(--accent-tint)] px-1.5 py-0.5 text-[9px] text-[var(--accent)]"
              :title="ref"
            >
              {{ shortRef(ref) }}
            </span>
          </div>
          <div class="flex min-w-0 items-center gap-2 text-[9.5px] text-[var(--text-tertiary)]">
            <span class="font-[family-name:var(--font-mono)]">{{
              row.commit.hash.slice(0, 7)
            }}</span>
            <span class="min-w-0 flex-1 truncate">{{ row.commit.author }}</span>
            <time :datetime="row.commit.authoredAt">{{ date(row.commit.authoredAt) }}</time>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

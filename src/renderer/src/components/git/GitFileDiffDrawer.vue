<script setup lang="ts">
import { ArrowLeft, FileCode2 } from '@lucide/vue'
import IconButton from '@renderer/components/ui/IconButton.vue'
import UnifiedDiffPreview from './UnifiedDiffPreview.vue'

/**
 * Overlay drawer for one file's diff, drawn over the graph pane — never
 * swapped into its place — so the graph's scroll position and pane widths
 * survive open and close.
 */
withDefaults(
  defineProps<{
    filePath: string
    patch: string
    loading?: boolean
    badge?: string | null
    commitHash?: string | null
    testId?: string
  }>(),
  { loading: false, badge: null, commitHash: null, testId: 'git-file-diff-drawer' }
)

defineEmits<{ close: [] }>()
</script>

<template>
  <section
    class="absolute inset-0 z-20 flex min-h-0 min-w-0 flex-col bg-[var(--bg-surface)]"
    :data-testid="testId"
  >
    <header
      class="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface-raised)] px-2"
    >
      <IconButton
        :label="$t('workspace.gitBackToGraph')"
        data-testid="git-back-to-graph"
        @click="$emit('close')"
      >
        <ArrowLeft class="size-3.5" />
      </IconButton>
      <FileCode2 class="size-3.5 shrink-0 text-[var(--accent)]" />
      <span class="min-w-0 flex-1 truncate text-[10.5px] font-medium text-[var(--text-primary)]">
        {{ filePath }}
      </span>
      <span
        v-if="commitHash"
        class="shrink-0 font-[family-name:var(--font-mono)] text-[9.5px] text-[var(--text-tertiary)]"
      >
        {{ commitHash.slice(0, 8) }}
      </span>
      <span
        v-if="badge"
        class="shrink-0 rounded border border-[var(--border-subtle)] px-1.5 py-0.5 text-[9px] text-[var(--text-tertiary)]"
      >
        {{ badge }}
      </span>
    </header>

    <div
      v-if="loading"
      class="flex min-h-0 flex-1 items-center justify-center text-[10.5px] text-[var(--text-tertiary)]"
    >
      {{ $t('common.loading') }}
    </div>
    <div
      v-else-if="!patch"
      class="flex min-h-0 flex-1 items-center justify-center gap-2 text-[10.5px] text-[var(--text-disabled)]"
    >
      <FileCode2 class="size-4" />
      {{ $t('workspace.gitNoPatch') }}
    </div>
    <UnifiedDiffPreview v-else :patch="patch" />
  </section>
</template>

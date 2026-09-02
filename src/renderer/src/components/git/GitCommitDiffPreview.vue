<script setup lang="ts">
import { computed } from 'vue'
import { ArrowLeft, FileCode2 } from '@lucide/vue'
import IconButton from '@renderer/components/ui/IconButton.vue'
import type { GitCommitFileInfo } from '@shared/types/workspace'
import { parseUnifiedDiff } from '@shared/workspace/unified-diff'

const props = defineProps<{
  file: GitCommitFileInfo
  patch: string
  loading: boolean
  commitHash: string
}>()

defineEmits<{ close: [] }>()

const MAX_RENDERED_LINES = 6_000
const parsedLines = computed(() => parseUnifiedDiff(props.patch))
const visibleLines = computed(() => parsedLines.value.slice(0, MAX_RENDERED_LINES))
const previewTruncated = computed(() => parsedLines.value.length > MAX_RENDERED_LINES)
</script>

<template>
  <section class="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--bg-surface)]" data-testid="git-historical-diff">
    <header
      class="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface-raised)] px-2"
    >
      <IconButton :label="$t('workspace.gitBackToGraph')" @click="$emit('close')">
        <ArrowLeft class="size-3.5" />
      </IconButton>
      <FileCode2 class="size-3.5 shrink-0 text-[var(--accent)]" />
      <span class="min-w-0 flex-1 truncate text-[10.5px] font-medium text-[var(--text-primary)]">
        {{ file.path }}
      </span>
      <span class="shrink-0 font-mono text-[9.5px] text-[var(--text-tertiary)]">
        {{ commitHash.slice(0, 8) }}
      </span>
      <span
        class="shrink-0 rounded border border-[var(--border-subtle)] px-1.5 py-0.5 text-[9px] text-[var(--text-tertiary)]"
      >
        {{ $t('workspace.gitHistoricalDiff') }}
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
    <div v-else class="min-h-0 min-w-0 flex-1 overflow-auto font-[family-name:var(--font-mono)]">
      <div class="diff-table min-w-max py-1 text-[10px] leading-[1.55]">
        <div
          v-for="(line, index) in visibleLines"
          :key="index"
          class="diff-line"
          :class="`diff-line--${line.kind}`"
        >
          <span class="diff-line-number">{{ line.oldLine ?? '' }}</span>
          <span class="diff-line-number">{{ line.newLine ?? '' }}</span>
          <code class="diff-line-content">{{ line.text || ' ' }}</code>
        </div>
        <div
          v-if="previewTruncated"
          class="border-t border-[var(--border-subtle)] px-3 py-2 text-[10px] text-[var(--warning)]"
        >
          {{ $t('workspace.gitDiffPreviewTruncated') }}
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.diff-line {
  display: grid;
  grid-template-columns: 48px 48px minmax(max-content, 1fr);
  min-height: 20px;
  color: var(--text-secondary);
}

.diff-line-number {
  border-right: 1px solid var(--border-subtle);
  padding: 0 8px;
  color: var(--text-disabled);
  text-align: right;
  user-select: none;
}

.diff-line-content {
  display: block;
  padding: 0 10px;
  white-space: pre;
}

.diff-line--addition {
  background: color-mix(in srgb, var(--success) 12%, transparent);
}

.diff-line--addition .diff-line-content {
  color: color-mix(in srgb, var(--success) 78%, var(--text-primary));
}

.diff-line--deletion {
  background: color-mix(in srgb, var(--danger) 11%, transparent);
}

.diff-line--deletion .diff-line-content {
  color: color-mix(in srgb, var(--danger) 78%, var(--text-primary));
}

.diff-line--hunk {
  border-block: 1px solid color-mix(in srgb, var(--accent) 18%, transparent);
  background: color-mix(in srgb, var(--accent) 9%, transparent);
  color: var(--accent);
}

.diff-line--meta {
  color: var(--text-tertiary);
}
</style>

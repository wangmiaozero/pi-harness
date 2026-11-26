<script setup lang="ts">
import { computed } from 'vue'
import { parseUnifiedDiff, splitUnifiedDiffLines } from '@shared/workspace/unified-diff'

const props = defineProps<{ patch: string; split?: boolean }>()
const MAX_RENDERED_LINES = 6_000
const parsedLines = computed(() => parseUnifiedDiff(props.patch))
const visibleLines = computed(() => parsedLines.value.slice(0, MAX_RENDERED_LINES))
const previewTruncated = computed(() => parsedLines.value.length > MAX_RENDERED_LINES)
const splitRows = computed(() => {
  const lines = visibleLines.value
  // The file header already identifies the paths for changes with text hunks.
  const firstHunk = lines.findIndex((line) => line.kind === 'hunk')
  return splitUnifiedDiffLines(firstHunk < 0 ? lines : lines.slice(firstHunk))
})
const sides = ['before', 'after'] as const
</script>

<template>
  <div
    data-testid="unified-diff-preview"
    class="min-h-0 min-w-0 flex-1 overflow-auto font-[family-name:var(--font-mono)]"
  >
    <div v-if="split" class="split-diff text-[11px] leading-[1.55]" data-testid="split-diff">
      <div class="split-diff-row split-diff-heading">
        <span>{{ $t('workspace.diffBefore') }}</span>
        <span>{{ $t('workspace.diffAfter') }}</span>
      </div>
      <div v-for="(row, index) in splitRows" :key="index" class="split-diff-row">
        <code
          v-if="row.kind === 'marker'"
          class="split-diff-marker"
          :class="`diff-line--${row.line.kind}`"
          >{{ row.line.text || ' ' }}</code
        >
        <template v-else>
          <div
            v-for="side in sides"
            :key="side"
            class="split-diff-cell"
            :class="row[side] ? `diff-line--${row[side].kind}` : 'split-diff-cell--empty'"
          >
            <span class="diff-line-number">{{
              side === 'before' ? row.before?.oldLine : row.after?.newLine
            }}</span>
            <code class="diff-line-content">{{ row[side]?.text.slice(1) || ' ' }}</code>
          </div>
        </template>
      </div>
    </div>
    <div v-else class="diff-table min-w-max py-1 text-[10.5px] leading-[1.55]">
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
    </div>
    <div
      v-if="previewTruncated"
      class="border-t border-[var(--border-subtle)] px-3 py-2 text-[10px] text-[var(--warning)]"
    >
      {{ $t('workspace.gitDiffPreviewTruncated') }}
    </div>
  </div>
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

.split-diff-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.split-diff-row > :nth-child(2) {
  border-inline-start: 1px solid var(--border-subtle);
}

.split-diff-heading {
  background: var(--bg-surface-raised);
  color: var(--text-secondary);
  font-family: var(--font-sans);
}

.split-diff-heading > span,
.split-diff-marker {
  padding: 4px 10px;
}

.split-diff-marker {
  grid-column: 1 / -1;
  overflow-wrap: anywhere;
}

.split-diff-cell {
  display: grid;
  grid-template-columns: max(11%, 28px) minmax(0, 1fr);
  align-items: stretch;
  min-height: 20px;
}

.split-diff-cell .diff-line-content {
  padding: 1px 7px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.split-diff-cell .diff-line-number {
  padding-inline: 3px;
  padding-top: 1px;
}

.split-diff-cell--empty {
  background: var(--bg-surface-raised);
}
</style>

<script setup lang="ts">
import { computed } from 'vue'
import { parseUnifiedDiff } from '@shared/workspace/unified-diff'

const props = defineProps<{ patch: string }>()
const MAX_RENDERED_LINES = 6_000
const parsedLines = computed(() => parseUnifiedDiff(props.patch))
const visibleLines = computed(() => parsedLines.value.slice(0, MAX_RENDERED_LINES))
const previewTruncated = computed(() => parsedLines.value.length > MAX_RENDERED_LINES)
</script>

<template>
  <div
    data-testid="unified-diff-preview"
    class="min-h-0 min-w-0 flex-1 overflow-auto font-[family-name:var(--font-mono)]"
  >
    <div class="diff-table min-w-max py-1 text-[10.5px] leading-[1.55]">
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

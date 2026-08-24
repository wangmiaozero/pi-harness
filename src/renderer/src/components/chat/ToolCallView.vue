<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ToolCallContent } from '@shared/types/workspace'

const props = defineProps<{
  block: ToolCallContent
  running?: boolean
  result?: string
  isError?: boolean
}>()

const open = ref(true)
const args = computed(() => JSON.stringify(props.block.input, null, 2))
</script>

<template>
  <div class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
    <button
      class="flex w-full items-center justify-between px-2.5 py-1.5 text-left"
      @click="open = !open"
    >
      <span class="font-[family-name:var(--font-mono)] text-[11.5px] text-[var(--text-primary)]">
        {{ block.toolName || $t('workspace.unknownTool') }}
      </span>
      <span class="text-[10.5px] text-[var(--text-tertiary)]">
        {{ running ? $t('workspace.running') : isError ? $t('common.failed') : $t('common.valid') }}
      </span>
    </button>
    <pre
      v-if="open"
      class="max-h-64 overflow-auto border-t border-[var(--border-subtle)] px-2.5 py-2 font-[family-name:var(--font-mono)] text-[11px] text-[var(--text-secondary)]"
    >{{ block.rawInput || args }}{{ result ? '\n---\n' + result : '' }}</pre>
  </div>
</template>

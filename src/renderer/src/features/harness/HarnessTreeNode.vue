<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { GitBranch, ListTree, Repeat2, RotateCcw, ShieldCheck } from '@lucide/vue'
import type { HarnessRunRelation, HarnessRunTreeNode } from '@shared/types/harness'
import HarnessTreeNode from './HarnessTreeNode.vue'

const props = defineProps<{ node: HarnessRunTreeNode; depth?: number }>()
defineEmits<{ open: [runId: string] }>()

const { t } = useI18n()

const relationIcon: Record<HarnessRunRelation, typeof ListTree> = {
  original: ListTree,
  fork: GitBranch,
  retry: RotateCcw,
  recovery: ShieldCheck,
  rerun: Repeat2
}

const relationTone: Record<HarnessRunRelation, string> = {
  original: 'text-[var(--text-tertiary)]',
  fork: 'text-[var(--accent)]',
  retry: 'text-[var(--warning)]',
  recovery: 'text-[var(--success)]',
  rerun: 'text-[var(--accent)]'
}

const statusTone: Record<string, string> = {
  success: 'text-[var(--success)]',
  failed: 'text-[var(--error)]',
  aborted: 'text-[var(--text-tertiary)]'
}
</script>

<template>
  <li :style="{ paddingLeft: `${(props.depth ?? 0) * 14}px` }">
    <button
      type="button"
      class="flex w-full items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1 text-left text-[11px] transition-colors hover:bg-[var(--bg-hover)]"
      data-testid="harness-tree-node"
      @click="$emit('open', node.runId)"
    >
      <component
        :is="relationIcon[node.relation] ?? ListTree"
        class="size-3 shrink-0"
        :class="relationTone[node.relation] ?? ''"
      />
      <span class="min-w-0 flex-1 truncate text-[var(--text-secondary)]">
        {{ node.prompt.slice(0, 60) || t('workspace.harnessRunUntitled') }}
      </span>
      <span
        class="shrink-0 text-[10px]"
        :class="statusTone[node.status] ?? 'text-[var(--text-tertiary)]'"
      >
        {{ t(`workspace.harnessRunStatus.${node.status}`) }}
      </span>
    </button>
    <ul
      v-if="node.children.length"
      class="mt-0.5 space-y-0.5 border-l border-[var(--border-subtle)]"
    >
      <HarnessTreeNode
        v-for="child in node.children"
        :key="child.runId"
        :node="child"
        :depth="(props.depth ?? 0) + 1"
        @open="$emit('open', $event)"
      />
    </ul>
  </li>
</template>

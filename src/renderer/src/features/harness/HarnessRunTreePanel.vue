<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ListTree } from '@lucide/vue'
import { useHarnessStore } from '@renderer/stores/harness'
import HarnessTreeNode from './HarnessTreeNode.vue'

const { t } = useI18n()
const harness = useHarnessStore()

const trees = computed(() => harness.runTree)

async function openDetail(runId: string): Promise<void> {
  await harness.loadRunDetail(runId)
}
</script>

<template>
  <section class="harness-card" data-testid="harness-run-tree-panel">
    <h3 class="harness-card-title">{{ t('workspace.harnessRunTree') }}</h3>
    <p v-if="!trees.length" class="mt-4 text-[12px] text-[var(--text-tertiary)]">
      {{ t('workspace.harnessRunTreeEmpty') }}
    </p>
    <div v-else class="mt-3 space-y-2">
      <div
        v-for="node in trees"
        :key="node.runId"
        class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)]"
        data-testid="harness-tree-root"
      >
        <ul class="space-y-0.5 p-2">
          <HarnessTreeNode :node="node" @open="openDetail" />
        </ul>
      </div>
    </div>
    <p class="mt-3 flex items-center gap-1.5 text-[10.5px] text-[var(--text-tertiary)]">
      <ListTree class="size-3" />
      {{ t('workspace.harnessRunTreeHint') }}
    </p>
  </section>
</template>

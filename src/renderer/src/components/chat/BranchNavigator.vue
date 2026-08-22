<script setup lang="ts">
import { computed } from 'vue'
import { ChevronLeft, ChevronRight } from '@lucide/vue'
import { getSiblingBranchIds } from '@shared/workspace/session-tree'
import { useAgentStore } from '@renderer/stores/agent'
import { useSessionStore } from '@renderer/stores/sessions'

const props = defineProps<{ entryId: string }>()
const agent = useAgentStore()
const sessions = useSessionStore()

const siblings = computed(() =>
  getSiblingBranchIds(
    Object.entries(agent.entryParents).map(([id, parentId]) => ({ id, parentId })),
    props.entryId
  )
)

const visible = computed(() => siblings.value.ids.length > 1)

async function go(delta: number) {
  const nextIndex = siblings.value.index + delta
  const target = siblings.value.ids[nextIndex]
  if (!target || !sessions.currentId) return
  await agent.navigate(sessions.currentId, target)
}
</script>

<template>
  <div v-if="visible" class="mt-1 flex items-center gap-1 text-[11px] text-[var(--text-tertiary)]">
    <button class="rounded p-0.5 hover:bg-[var(--bg-hover)]" @click="go(-1)">
      <ChevronLeft class="size-3.5" :stroke-width="1.75" />
    </button>
    <span>{{ siblings.index + 1 }} / {{ siblings.ids.length }}</span>
    <button class="rounded p-0.5 hover:bg-[var(--bg-hover)]" @click="go(1)">
      <ChevronRight class="size-3.5" :stroke-width="1.75" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { getApi } from '@renderer/composables/useApi'
import type { SessionHandoff } from '@shared/universal/schema'
const props = defineProps<{ sessionId: string | null }>()
const { t } = useI18n()
const origin = ref<SessionHandoff | null>(null)
let revision = 0
watch(
  () => props.sessionId,
  async (id) => {
    const current = ++revision
    origin.value = null
    if (!id) return
    try {
      const value = await getApi().universal.origin(id)
      if (current === revision) origin.value = value
    } catch {
      /* Native sessions have no external source. */
    }
  },
  { immediate: true }
)
</script>
<template>
  <aside
    v-if="origin"
    class="shrink-0 border-b border-[var(--border-subtle)] px-4 py-2 text-xs text-[var(--text-secondary)]"
    data-testid="pi-task-origin"
  >
    {{ t('universal.sourceTrace') }}:
    <RouterLink
      :to="{ path: '/ai-sessions', query: { source: origin.sourceSessionId } }"
      class="text-[var(--accent)]"
      >{{ origin.sourceProvider }} · {{ origin.sourceSessionId.slice(0, 12) }}</RouterLink
    >
    <span class="ml-2" :title="origin.id"
      >{{ t('universal.preview') }} · {{ origin.id.slice(0, 12) }}</span
    >
  </aside>
</template>

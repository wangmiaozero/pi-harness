<script setup lang="ts">
import { computed } from 'vue'
import { History, LoaderCircle, MessageSquare } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import type { SessionDetail } from '@shared/types/workspace'
import Dialog from '@renderer/components/ui/Dialog.vue'
import EmptyState from '@renderer/components/ui/EmptyState.vue'
import MessageView from './MessageView.vue'

const props = defineProps<{
  detail: SessionDetail | null
  loading: boolean
}>()

const open = defineModel<boolean>('open', { default: false })
const { t } = useI18n()

const messages = computed(() => props.detail?.context.messages ?? [])
const description = computed(() => {
  if (props.loading) return t('common.loading')
  const sessionName = props.detail?.info?.name?.trim()
  const count = messages.value.length
  return sessionName
    ? t('workspace.fullHistorySummaryNamed', { name: sessionName, count })
    : t('workspace.fullHistorySummary', { count })
})
</script>

<template>
  <Dialog
    v-model:open="open"
    large
    prominent-title
    :title="t('workspace.fullHistory')"
    :description="description"
  >
    <div
      data-testid="full-history-dialog"
      class="full-history-dialog min-h-[min(520px,66vh)] border-t border-[var(--border-subtle)]"
    >
      <EmptyState
        v-if="loading"
        class="min-h-[min(520px,66vh)]"
        :title="t('common.loading')"
        :icon="LoaderCircle"
      />
      <EmptyState
        v-else-if="!messages.length"
        class="min-h-[min(520px,66vh)]"
        :title="t('workspace.fullHistoryEmpty')"
        :icon="MessageSquare"
      />
      <div v-else class="px-1 py-3">
        <div
          class="mb-3 flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-[11px] text-[var(--text-secondary)]"
        >
          <History aria-hidden="true" class="size-3.5 shrink-0 text-[var(--accent)]" />
          <span>{{ t('workspace.fullHistoryHint') }}</span>
        </div>
        <MessageView v-for="(message, index) in messages" :key="index" :message="message" />
      </div>
    </div>
  </Dialog>
</template>

<style scoped>
.full-history-dialog :deep(.message-hud:last-child) {
  margin-bottom: 0;
}

.full-history-dialog :deep(.lucide-loader-circle) {
  animation: spin 0.8s linear infinite;
}
</style>

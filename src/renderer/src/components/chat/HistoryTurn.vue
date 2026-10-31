<script setup lang="ts">
import { ChevronRight, Wrench } from '@lucide/vue'
import type { AssistantMessage } from '@shared/types/workspace'
import type { ConversationItem, buildMessagePresentation } from './message-activity'
import MessageView from './MessageView.vue'
import AssistantTurn from './AssistantTurn.vue'
defineProps<{
  turn: ConversationItem
  userName: string
  assistantName: string
  running?: boolean
  liveMessage?: AssistantMessage | null
  isLast: boolean
  presentation: ReturnType<typeof buildMessagePresentation>
  revealed: Set<string>
  summaries: Map<
    string,
    {
      text: string
      target: string
      icon: typeof Wrench
      running: boolean
      error: boolean
      warning: boolean
      note: string
      outcome: string
    }
  >
}>()
const emit = defineEmits<{ reveal: [key: string] }>()
function toggle(key: string, event: Event) {
  if ((event.target as HTMLDetailsElement).open) emit('reveal', key)
}
</script>
<template>
  <MessageView
    v-if="turn.type === 'message'"
    :data-minimap-id="turn.key"
    :message="turn.item.message"
    :entry-id="turn.item.entryId"
    :user-name="userName"
    :assistant-name="assistantName"
  />
  <AssistantTurn
    v-else
    :assistant-name="assistantName"
    :text="turn.text"
    :streaming="running && isLast"
  >
    <template v-for="item in turn.items" :key="item.key">
      <MessageView
        v-if="item.type === 'message'"
        :data-minimap-id="item.key"
        :message="item.item.message"
        :entry-id="item.item.entryId"
        :user-name="userName"
        :assistant-name="assistantName"
        :file-changes="item.item.fileChanges"
        :tool-results="presentation.results.get(item.key)"
        :pending-tool-calls="presentation.pending"
        :activity-running="running"
        :embedded="item.item.message.role === 'assistant'"
      />
      <details
        v-else
        class="activity-group mb-4"
        data-testid="message-activity"
        :data-outcome="summaries.get(item.key)?.outcome"
        @toggle.self="toggle(item.key, $event)"
      >
        <summary
          class="activity-group-summary"
          :class="{
            'activity-group-error': summaries.get(item.key)?.error,
            'activity-group-warning': summaries.get(item.key)?.warning
          }"
        >
          <component
            :is="summaries.get(item.key)?.icon"
            aria-hidden="true"
            class="size-3.5 shrink-0"
            :class="{ 'animate-spin': summaries.get(item.key)?.running }"
          />
          <span class="min-w-0 truncate">{{ summaries.get(item.key)?.text }}</span>
          <span
            v-if="summaries.get(item.key)?.target"
            class="min-w-0 truncate text-[var(--text-tertiary)]"
            >{{ summaries.get(item.key)?.target }}</span
          >
          <span v-if="summaries.get(item.key)?.note" class="shrink-0"
            >· {{ summaries.get(item.key)?.note }}</span
          >
          <ChevronRight aria-hidden="true" class="group-chevron size-3 shrink-0" />
        </summary>
        <div v-if="revealed.has(item.key)" class="activity-group-content">
          <MessageView
            v-for="entry in item.items"
            :key="entry.key"
            :message="entry.message"
            :entry-id="entry.entryId"
            :user-name="userName"
            :assistant-name="assistantName"
            :tool-results="presentation.results.get(entry.key)"
            :pending-tool-calls="presentation.pending"
            :activity-running="running"
            embedded
          />
        </div>
      </details>
    </template>
    <MessageView v-if="liveMessage && isLast" :message="liveMessage" embedded streaming />
  </AssistantTurn>
</template>
<style scoped>
.activity-group {
  min-width: 0;
}
.activity-group-summary {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 7px;
  padding: 7px 14px;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.5;
  cursor: pointer;
  list-style: none;
}
.activity-group-summary::-webkit-details-marker {
  display: none;
}
.activity-group-summary:hover {
  color: var(--text-primary);
}
.activity-group-summary:focus-visible {
  outline: none;
  border-radius: var(--radius-xs);
  box-shadow: var(--focus-ring);
}
.group-chevron {
  color: var(--text-tertiary);
}
.activity-group[open] > summary .group-chevron {
  transform: rotate(90deg);
}
.activity-group-content {
  margin: 2px 14px 10px 21px;
  padding-left: 13px;
  border-left: 1px solid var(--border-subtle);
}
.activity-group-content :deep(.assistant-message-body) {
  padding: 0;
}
.activity-group-content :deep(.message-hud:last-child) {
  margin-bottom: 0;
}
.activity-group-error {
  color: var(--danger);
}
.activity-group-warning {
  color: var(--warning);
}
</style>

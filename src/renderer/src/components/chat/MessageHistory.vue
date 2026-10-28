<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  BookOpen,
  Brain,
  ChevronRight,
  CircleAlert,
  LoaderCircle,
  Terminal,
  Wrench
} from '@lucide/vue'
import MessageView from './MessageView.vue'
import AssistantTurn from './AssistantTurn.vue'
import type { AssistantMessage } from '@shared/types/workspace'
import {
  buildMessagePresentation,
  groupConversationTurns,
  toolActivityKind,
  toolActivityTarget,
  type ActivityKind,
  type HistoryItem
} from './message-activity'

// Keep persisted presentation independent of live token deltas.
const props = defineProps<{
  items: HistoryItem[]
  userName: string
  assistantName: string
  running?: boolean
  liveMessage?: AssistantMessage | null
}>()
const { t } = useI18n()
const revealed = ref(new Set<string>())
const presentation = computed(() => buildMessagePresentation(props.items))
const conversation = computed(() => groupConversationTurns(presentation.value.items))
const lastTurn = computed(() =>
  conversation.value.at(-1)?.type === 'turn' ? conversation.value.at(-1)?.key : null
)
const summaries = computed(() => {
  const summaries = new Map<
    string,
    { text: string; target: string; icon: typeof Wrench; running: boolean; error: boolean }
  >()
  for (const group of presentation.value.items) {
    if (group.type !== 'activity') continue
    const counts = new Map<ActivityKind, number>()
    let target = ''
    let activeKind: ActivityKind | null = null
    let error = false
    let complete = true
    for (const item of group.items) {
      const message = item.message
      if (message.role === 'assistant') {
        for (const block of message.content) {
          if (block.type === 'thinking') {
            if (!counts.has('thinking')) counts.set('thinking', 1)
          } else if (block.type === 'toolCall') {
            const kind = toolActivityKind(block.toolName)
            counts.set(kind, (counts.get(kind) ?? 0) + 1)
            const result = presentation.value.results.get(item.key)?.get(block.toolCallId)
            error ||= result?.message.isError === true
            complete &&= Boolean(result)
            if (props.running && presentation.value.pending.get(block.toolCallId) === item.key) {
              activeKind = kind
              target = toolActivityTarget(block) || block.toolName
            }
          }
        }
      } else if (message.role === 'toolResult') {
        const kind = toolActivityKind(message.toolName ?? '')
        counts.set(kind, (counts.get(kind) ?? 0) + 1)
        error ||= message.isError === true
      } else if (message.role === 'bashExecution') {
        counts.set('command', (counts.get('command') ?? 0) + 1)
        error ||=
          message.cancelled === true || (message.exitCode !== undefined && message.exitCode !== 0)
      }
    }
    if (counts.size > 1) counts.delete('thinking')
    const text = activeKind
      ? t(`workspace.activity.running.${activeKind}`)
      : [...counts]
          .map(
            ([kind, count]) =>
              `${t(`workspace.activity.${complete ? 'done' : 'pending'}.${kind}`)}${count > 1 ? ` · ${count}` : ''}`
          )
          .join(' · ')
    const icon = activeKind
      ? LoaderCircle
      : error
        ? CircleAlert
        : counts.has('command')
          ? Terminal
          : counts.has('read') || counts.has('search')
            ? BookOpen
            : counts.has('thinking')
              ? Brain
              : Wrench
    summaries.set(group.key, { text, target, icon, running: Boolean(activeKind), error })
  }
  return summaries
})

function toggle(key: string, event: Event) {
  if ((event.target as HTMLDetailsElement).open) revealed.value.add(key)
}
</script>

<template>
  <template v-for="turn in conversation" :key="turn.key">
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
      :streaming="running && lastTurn === turn.key"
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
          @toggle.self="toggle(item.key, $event)"
        >
          <summary
            class="activity-group-summary"
            :class="{ 'activity-group-error': summaries.get(item.key)?.error }"
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
            <span v-if="summaries.get(item.key)?.error" class="shrink-0"
              >· {{ t('common.failed') }}</span
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
      <MessageView
        v-if="liveMessage && lastTurn === turn.key"
        :message="liveMessage"
        embedded
        streaming
      />
    </AssistantTurn>
  </template>
  <AssistantTurn v-if="liveMessage && !lastTurn" :assistant-name="assistantName" text="" streaming>
    <MessageView :message="liveMessage" embedded streaming />
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
</style>

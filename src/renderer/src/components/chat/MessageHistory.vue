<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { BookOpen, Brain, CircleAlert, LoaderCircle, Terminal, Wrench } from '@lucide/vue'
import MessageView from './MessageView.vue'
import AssistantTurn from './AssistantTurn.vue'
import HistoryTurn from './HistoryTurn.vue'
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
</script>

<template>
  <HistoryTurn
    v-for="turn in conversation"
    :key="turn.key"
    :turn="turn"
    :user-name="userName"
    :assistant-name="assistantName"
    :running="running"
    :live-message="lastTurn === turn.key ? liveMessage : null"
    :is-last="lastTurn === turn.key"
    :presentation="presentation"
    :summaries="summaries"
    :revealed="revealed"
    @reveal="revealed.add($event)"
  />
  <AssistantTurn v-if="liveMessage && !lastTurn" :assistant-name="assistantName" text="" streaming>
    <MessageView :message="liveMessage" embedded streaming />
  </AssistantTurn>
</template>

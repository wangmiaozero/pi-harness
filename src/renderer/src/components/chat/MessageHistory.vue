<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { BookOpen, Brain, CircleAlert, LoaderCircle, Terminal, Wrench } from '@lucide/vue'
import MessageView from './MessageView.vue'
import AssistantTurn from './AssistantTurn.vue'
import HistoryTurn from './HistoryTurn.vue'
import type { AssistantMessage } from '@shared/types/workspace'
import { toolOutcome } from './tool-outcome'
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
  // A normal Native final reply is evidence that execution continued after a
  // failed step. Neither idle state nor arbitrary assistant text proves this.
  const finalReplies = new Set(
    props.items
      .filter(
        ({ message }) =>
          message.role === 'assistant' &&
          message.stopReason === 'stop' &&
          !message.errorMessage &&
          !message.content.some((block) => block.type === 'toolCall') &&
          message.content.some((block) => block.type === 'text' && block.text.trim())
      )
      .map((item) => item.key)
  )
  const endedGroups = new Set<string>()
  for (const turn of conversation.value) {
    if (turn.type !== 'turn') continue
    let ended = false
    for (const item of [...turn.items].reverse()) {
      if (item.type === 'message' && finalReplies.has(item.key)) ended = true
      if (item.type === 'activity' && ended) endedGroups.add(item.key)
    }
  }
  const summaries = new Map<
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
  >()
  for (const group of presentation.value.items) {
    if (group.type !== 'activity') continue
    const counts = new Map<ActivityKind, number>()
    let target = ''
    let activeKind: ActivityKind | null = null
    let failures = 0
    let noMatches = 0
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
            const outcome = toolOutcome(block, result?.message)
            failures += Number(outcome === 'error')
            noMatches += Number(outcome === 'no-match')
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
        const outcome = toolOutcome(undefined, message)
        failures += Number(outcome === 'error')
        noMatches += Number(outcome === 'no-match')
      } else if (message.role === 'bashExecution') {
        counts.set('command', (counts.get('command') ?? 0) + 1)
        const outcome = toolOutcome(
          {
            type: 'toolCall',
            toolCallId: '',
            toolName: 'bash',
            input: { command: message.command }
          },
          {
            role: 'toolResult',
            toolCallId: '',
            content: [{ type: 'text', text: message.output }],
            isError:
              message.cancelled === true ||
              (message.exitCode !== undefined && message.exitCode !== 0),
            details: { exitCode: message.exitCode, cancelled: message.cancelled }
          }
        )
        failures += Number(outcome === 'error')
        noMatches += Number(outcome === 'no-match')
      }
    }
    if (counts.size > 1) counts.delete('thinking')
    const warning = failures > 0 && complete && endedGroups.has(group.key)
    const error = failures > 0 && !warning
    const note = failures
      ? warning
        ? t('workspace.activity.endedWithErrors', { count: failures })
        : t('workspace.activity.failedSteps', { count: failures })
      : noMatches
        ? t('workspace.activity.emptySearches', { count: noMatches })
        : ''
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
      : failures
        ? CircleAlert
        : counts.has('command')
          ? Terminal
          : counts.has('read') || counts.has('search')
            ? BookOpen
            : counts.has('thinking')
              ? Brain
              : Wrench
    summaries.set(group.key, {
      text,
      target,
      icon,
      running: Boolean(activeKind),
      error,
      warning,
      note,
      outcome: warning
        ? 'completed-with-errors'
        : error
          ? 'error'
          : activeKind
            ? 'running'
            : noMatches
              ? 'no-match'
              : 'success'
    })
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
  <AssistantTurn
    v-if="!lastTurn && (liveMessage || running)"
    :assistant-name="assistantName"
    text=""
    :streaming="running"
  >
    <MessageView v-if="liveMessage" :message="liveMessage" embedded :streaming="running" />
  </AssistantTurn>
</template>

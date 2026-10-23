<script setup lang="ts">
import type { AgentMessage } from '@shared/types/workspace'
import type { MessageFileChanges } from './message-file-changes'
import MessageView from './MessageView.vue'

// Keep the persisted transcript independent of the live token stream.
defineProps<{
  items: Array<{
    key: string
    message: AgentMessage
    entryId?: string
    fileChanges?: MessageFileChanges
  }>
  userName: string
  assistantName: string
}>()
</script>

<template>
  <MessageView
    v-for="item in items"
    :key="item.key"
    :data-minimap-id="item.key"
    :message="item.message"
    :entry-id="item.entryId"
    :user-name="userName"
    :assistant-name="assistantName"
    :file-changes="item.fileChanges"
  />
</template>

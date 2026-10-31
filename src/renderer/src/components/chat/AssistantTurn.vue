<script setup lang="ts">
import { LoaderCircle } from '@lucide/vue'
import MessageActions from './MessageActions.vue'

defineProps<{ assistantName: string; text: string; streaming?: boolean }>()
</script>

<template>
  <article
    class="message-hud assistant-turn group mb-3"
    data-message-role="assistant"
    data-testid="assistant-turn"
  >
    <p class="message-role-label">
      <span class="message-role-badge" :role="streaming ? 'status' : undefined"
        ><LoaderCircle
          v-if="streaming"
          data-testid="assistant-loading"
          aria-hidden="true"
          class="size-3 shrink-0 animate-spin motion-reduce:animate-none"
        />{{ assistantName }}<span v-if="streaming"> · {{ $t('workspace.streaming') }}</span></span
      >
    </p>
    <div class="assistant-turn-content"><slot /></div>
    <MessageActions v-if="text.trim() && !streaming" :text="text" role="assistant" />
  </article>
</template>

<style scoped>
.assistant-turn {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  margin-inline: auto;
  overflow-wrap: anywhere;
}
.message-role-label {
  display: flex;
  align-items: center;
  margin-bottom: 6px;
  color: var(--text-tertiary);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.05em;
  line-height: 1.3;
}
.message-role-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 21px;
  padding: 2px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg-surface-raised) 78%, transparent);
}
.assistant-turn-content {
  padding: 10px 14px 0;
}
.assistant-turn-content :deep(.message-part .assistant-message-body) {
  padding: 0;
}
.assistant-turn-content :deep(.activity-group-summary) {
  padding-inline: 0;
}
.assistant-turn-content :deep(.activity-group-content) {
  margin-inline: 7px 0;
}
.assistant-turn-content :deep(.message-part:last-child) {
  margin-bottom: 0;
}
</style>

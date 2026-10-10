<script setup lang="ts">
import type { UniversalMessage } from '@shared/universal/schema'
import HistoricalText from './HistoricalText.vue'
defineProps<{ message: UniversalMessage }>()
</script>

<template>
  <article
    class="history-message rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3"
    :data-history-role="message.role"
  >
    <header class="mb-2 flex justify-between text-xs text-[var(--text-tertiary)]">
      <strong>{{ message.role }}</strong
      ><time>{{ message.timestamp }}</time>
    </header>
    <template v-for="(part, index) in message.parts" :key="index">
      <HistoricalText
        v-if="part.type === 'text' || part.type === 'code'"
        :text="
          part.type === 'code'
            ? '```' + (part.language ?? '') + '\n' + part.text + '\n```'
            : part.text
        "
      />
      <details v-else-if="part.type === 'thinking'" class="mb-2">
        <summary>Thinking / Reasoning</summary>
        <pre class="history-prose">{{ part.text }}</pre>
      </details>
      <details v-else-if="part.type === 'tool-call'" class="mb-2">
        <summary>{{ part.name }} · {{ part.callId }}</summary>
        <pre class="history-code">{{ part.input }}</pre>
      </details>
      <details
        v-else-if="part.type === 'tool-result'"
        class="mb-2"
        :class="{ 'text-[var(--error)]': part.isError }"
      >
        <summary>Tool result · {{ part.callId }}</summary>
        <pre class="history-code">{{ part.text }}</pre>
      </details>
      <pre v-else-if="part.type === 'error'" class="history-prose text-[var(--error)]">{{
        part.text
      }}</pre>
      <span
        v-else-if="part.type === 'image-reference'"
        class="block text-xs text-[var(--text-secondary)]"
        >Image · {{ part.mimeType }} · {{ part.reference }}</span
      >
      <span v-else-if="part.type === 'file-reference'" class="block text-xs"
        >File · {{ part.path }}</span
      >
      <span v-else-if="part.type === 'usage'" class="block text-xs text-[var(--text-tertiary)]"
        >Tokens · {{ part.total ?? (part.input ?? 0) + (part.output ?? 0) }}
        <span v-if="part.cost !== undefined"> · ${{ part.cost }}</span></span
      >
      <details v-else-if="part.type === 'native-event'" class="text-xs text-[var(--text-tertiary)]">
        <summary>{{ part.eventType }}</summary>
        <pre class="history-code">{{ part.text }}</pre>
      </details>
    </template>
    <footer class="mt-2 break-all text-[10px] text-[var(--text-tertiary)]">
      {{ message.sourceRef }}
    </footer>
  </article>
</template>
<style scoped>
.history-prose {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: inherit;
  margin: 0 0 8px;
}
.history-code {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 12px;
  padding: 8px;
  background: var(--bg-inset);
  border-radius: var(--radius-sm);
}
summary {
  cursor: pointer;
  font-size: 12px;
}
</style>

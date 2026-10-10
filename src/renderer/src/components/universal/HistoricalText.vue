<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps<{ text: string }>()
const segments = computed(() => {
  const result: Array<{ language?: string; text: string }> = []
  let start = 0
  const pattern = /```([^\n`]*)\n([\s\S]*?)```/g
  for (const match of props.text.matchAll(pattern)) {
    if (match.index! > start) result.push({ text: props.text.slice(start, match.index) })
    result.push({ language: match[1]?.trim() || 'text', text: match[2] ?? '' })
    start = match.index! + match[0].length
  }
  if (start < props.text.length) result.push({ text: props.text.slice(start) })
  return result
})
</script>
<template>
  <div class="historical-text">
    <template v-for="(segment, index) in segments" :key="index">
      <div
        v-if="segment.language"
        class="mb-2 overflow-hidden rounded border border-[var(--border-subtle)]"
      >
        <p class="bg-[var(--bg-inset)] px-2 py-1 text-[10px] text-[var(--text-tertiary)]">
          {{ segment.language }}
        </p>
        <pre
          class="code p-2"
        ><code><template v-for="(line, i) in segment.text.split('\n')" :key="i"><span class="block" :class="segment.language === 'diff' ? line.startsWith('+') ? 'text-[var(--success)]' : line.startsWith('-') ? 'text-[var(--error)]' : '' : ''">{{ line || ' ' }}</span></template></code></pre>
      </div>
      <pre v-else class="prose">{{ segment.text }}</pre>
    </template>
  </div>
</template>
<style scoped>
.prose {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: inherit;
  margin: 0 0 8px;
}
.code {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 12px;
}
</style>

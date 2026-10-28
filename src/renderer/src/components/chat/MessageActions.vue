<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { Check, Copy } from '@lucide/vue'
import { callApi, getApi } from '@renderer/composables/useApi'

const props = defineProps<{ text: string; role: 'user' | 'assistant' }>()
const copied = ref(false)
let resetTimer: ReturnType<typeof setTimeout> | null = null
async function copy() {
  if (!props.text) return
  try {
    await callApi(() => getApi().system.copyText(props.text))
  } catch {
    await navigator.clipboard.writeText(props.text)
  }
  copied.value = true
  if (resetTimer) clearTimeout(resetTimer)
  resetTimer = setTimeout(() => {
    copied.value = false
  }, 1500)
}
onBeforeUnmount(() => {
  if (resetTimer) clearTimeout(resetTimer)
})
</script>

<template>
  <div
    class="message-actions mt-1 flex items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
  >
    <button
      type="button"
      class="inline-flex size-6 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-tertiary)] hover:bg-[var(--bg-surface-raised)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
      :title="$t('workspace.copyMessage')"
      :aria-label="$t('workspace.copyMessage')"
      :data-testid="`copy-${role}-message`"
      @click="copy"
    >
      <Check v-if="copied" class="size-3.5" />
      <Copy v-else class="size-3.5" />
    </button>
  </div>
</template>

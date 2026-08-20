<script setup lang="ts">
/* macOS-style Property Row. Used in Inspector / Settings / Diagnostics.
 * Label left, value right. 30-34px row height. Very subtle hairline between
 * rows.
 *
 * Truncated values must expose full text on hover (native `title`). Pass
 * `title` explicitly for interactive slots; otherwise we sync from text. */
import { computed, onMounted, onUpdated, ref, useSlots } from 'vue'

const props = defineProps<{
  label: string
  mono?: boolean
  /** Full text for hover tooltip. Prefer this when the slot is not plain text. */
  title?: string
}>()

const slots = useSlots()
const valueEl = ref<HTMLElement | null>(null)
const autoTitle = ref('')

function syncAutoTitle() {
  if (props.title != null) return
  autoTitle.value = valueEl.value?.innerText?.trim().replace(/\s+/g, ' ') ?? ''
}

onMounted(syncAutoTitle)
onUpdated(syncAutoTitle)

const resolvedTitle = computed(() => {
  if (props.title != null && props.title !== '') return props.title
  // Skip tooltip when the slot is only interactive controls (no readable text).
  if (!slots.default) return undefined
  return autoTitle.value || undefined
})
</script>

<template>
  <div
    class="flex items-center gap-3 px-3 py-[7px] min-h-[30px] border-t border-[var(--border-subtle)] first:border-t-0"
  >
    <span class="shrink-0 w-[140px] text-[11.5px] text-[var(--text-tertiary)]">{{ label }}</span>
    <span
      ref="valueEl"
      class="min-w-0 flex-1 truncate text-[12px] text-[var(--text-primary)]"
      :class="mono ? 'font-[family-name:var(--font-mono)]' : ''"
      :title="resolvedTitle"
    >
      <slot />
    </span>
  </div>
</template>

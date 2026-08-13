<script setup lang="ts">
/* macOS-style Property Row. Used in Inspector / Settings / Diagnostics.
 * Label left, value right. 30-34px row height. Very subtle hairline between
 * rows. */
defineProps<{
  label: string
  mono?: boolean
}>()
</script>

<template>
  <div
    class="flex items-center gap-3 px-3 py-[7px] min-h-[30px] border-t border-[var(--border-subtle)] first:border-t-0"
  >
    <span class="shrink-0 w-[140px] text-[11.5px] text-[var(--text-tertiary)]">{{ label }}</span>
    <span
      class="min-w-0 flex-1 truncate text-[12px] text-[var(--text-primary)]"
      :class="mono ? 'font-[family-name:var(--font-mono)]' : ''"
    >
      <slot />
    </span>
  </div>
</template>

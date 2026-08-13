<script setup lang="ts">
/* macOS-style compact search field — used by the titlebar command palette
 * trigger and by inline page filters. */
import { Search } from '@lucide/vue'

defineProps<{
  modelValue: string
  placeholder?: string
  shortcut?: string
  size?: 'sm' | 'md'
  ariaLabel?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()
</script>

<template>
  <label
    class="group flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--control-border)] bg-[var(--control-bg)] shadow-[var(--control-shadow)] transition-[background-color,border-color,box-shadow] duration-[var(--motion-fast)] ease-[var(--ease-out)] hover:border-[var(--control-border-hover)] hover:bg-[var(--control-bg-hover)] focus-within:border-[var(--accent)] focus-within:bg-[var(--control-bg-hover)] focus-within:shadow-[var(--focus-ring)]"
    :class="size === 'sm' ? 'h-7 px-2' : 'h-[var(--height-input)] px-2.5'"
  >
    <Search
      aria-hidden="true"
      class="size-3 shrink-0 text-[var(--text-tertiary)]"
      :stroke-width="1.75"
    />
    <input
      type="search"
      :value="modelValue"
      :placeholder="placeholder"
      :aria-label="ariaLabel ?? placeholder"
      class="min-w-0 flex-1 bg-transparent text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--control-placeholder)]"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
    <span
      v-if="shortcut"
      class="hidden shrink-0 rounded border border-[var(--border-default)] bg-[var(--bg-hover)] px-1 font-[family-name:var(--font-mono)] text-[10px] text-[var(--text-tertiary)] sm:inline"
    >
      {{ shortcut }}
    </span>
  </label>
</template>

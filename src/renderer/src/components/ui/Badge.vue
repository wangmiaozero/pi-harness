<script setup lang="ts">
import { computed } from 'vue'

type Tone =
  | 'default'
  | 'accent'
  | 'success'
  | 'warning'
  | 'error'
  | 'muted'
  | 'tools'
  | 'vision'
  | 'reasoning'
  | 'streaming'

const props = withDefaults(
  defineProps<{
    tone?: Tone
  }>(),
  { tone: 'default' }
)

/* Compact 18-20px pill. No loud colors — semantic tints only when needed. */
const classes = computed(() => {
  const base =
    'inline-flex items-center gap-1 rounded-[4px] px-1.5 h-[18px] text-[10.5px] font-medium leading-none ' +
    'border transition-colors duration-[var(--motion-fast)] ease-[var(--ease-out)] whitespace-nowrap'
  const tones: Record<Tone, string> = {
    default: 'border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)]',
    accent: 'border-[var(--accent-border)] bg-[var(--accent-tint)] text-[var(--accent)]',
    success: 'border-[var(--success)]/30 bg-[var(--success-tint)] text-[var(--success)]',
    warning: 'border-[var(--warning)]/30 bg-[var(--warning-tint)] text-[var(--warning)]',
    error: 'border-[var(--error)]/30 bg-[var(--error-tint)] text-[var(--error)]',
    muted: 'border-transparent bg-[var(--bg-hover)] text-[var(--text-tertiary)]',
    tools: 'border-transparent bg-[var(--tone-tools-bg)] text-[var(--tone-tools-text)]',
    vision: 'border-transparent bg-[var(--tone-vision-bg)] text-[var(--tone-vision-text)]',
    reasoning: 'border-transparent bg-[var(--tone-reasoning-bg)] text-[var(--tone-reasoning-text)]',
    streaming: 'border-transparent bg-[var(--tone-streaming-bg)] text-[var(--tone-streaming-text)]'
  }
  return [base, tones[props.tone]].join(' ')
})
</script>

<template>
  <span :class="classes">
    <slot />
  </span>
</template>

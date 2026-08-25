<script setup lang="ts">
import { computed } from 'vue'

/* Compact icon button. Square 28×28 by default; pass showLabel to render the
 * accessible name next to the icon so row actions are readable without hover. */

type Variant = 'default' | 'accent' | 'danger'

const props = withDefaults(
  defineProps<{
    variant?: Variant
    disabled?: boolean
    label?: string
    active?: boolean
    showLabel?: boolean
  }>(),
  {
    variant: 'default',
    disabled: false,
    label: '',
    active: false,
    showLabel: false
  }
)

const classes = computed(() => {
  const sizing = props.showLabel ? 'h-6 px-1 gap-0.5 text-[11px] font-medium' : 'size-7'
  const base =
    'inline-flex items-center justify-center rounded-[var(--radius-sm)] ' +
    sizing +
    ' transition-[color,background-color,border-color,box-shadow] duration-[var(--motion-fast)] ease-[var(--ease-out)] ' +
    'focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] ' +
    'disabled:opacity-40'

  if (props.active) {
    return (
      base +
      ' border border-[var(--accent-border)] bg-[var(--accent-tint-strong)] text-[var(--accent)]'
    )
  }

  if (props.variant === 'danger') {
    return (
      base +
      ' border border-transparent bg-transparent text-[var(--text-tertiary)] hover:border-[var(--error)] hover:text-[var(--error)] hover:bg-[var(--error-tint)] active:bg-[var(--error-tint)]'
    )
  }

  if (props.variant === 'accent') {
    return (
      base +
      ' border border-[var(--accent-border)] bg-[var(--accent-tint)] text-[var(--accent)] hover:bg-[var(--accent-tint-strong)] active:bg-[var(--bg-selected)]'
    )
  }

  return (
    base +
    ' border border-transparent bg-transparent text-[var(--text-tertiary)] hover:border-[var(--border-default)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] active:border-[var(--accent-border)] active:bg-[var(--accent-tint-strong)] active:text-[var(--accent)]'
  )
})
</script>

<template>
  <button type="button" :class="classes" :disabled="disabled" :aria-label="label" :title="label">
    <slot />
    <span v-if="showLabel && label" class="whitespace-nowrap leading-none">{{ label }}</span>
  </button>
</template>

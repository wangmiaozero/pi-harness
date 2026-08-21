<script setup lang="ts">
import { computed } from 'vue'

/* Compact icon button. Square 28×28 by default; pass showLabel to render the
 * accessible name next to the icon so row actions are readable without hover. */

type Variant = 'default' | 'danger'

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
  const sizing = props.showLabel
    ? 'h-6 px-1 gap-0.5 text-[11px] font-medium'
    : 'size-7'
  const base =
    'inline-flex items-center justify-center rounded-[var(--radius-sm)] ' +
    sizing +
    ' transition-colors duration-[var(--motion-fast)] ease-[var(--ease-out)] ' +
    'focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] ' +
    'disabled:opacity-40 disabled:pointer-events-none'

  if (props.active) {
    return base + ' bg-[var(--accent-tint)] text-[var(--accent)]'
  }

  if (props.variant === 'danger') {
    return (
      base +
      ' bg-transparent text-[var(--text-tertiary)] hover:text-[var(--error)] hover:bg-[var(--error-tint)]'
    )
  }

  return (
    base +
    ' bg-transparent text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
  )
})
</script>

<template>
  <button type="button" :class="classes" :disabled="disabled" :aria-label="label" :title="label">
    <slot />
    <span v-if="showLabel && label" class="whitespace-nowrap leading-none">{{ label }}</span>
  </button>
</template>

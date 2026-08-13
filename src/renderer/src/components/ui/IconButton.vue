<script setup lang="ts">
import { computed } from 'vue'

/* Square icon button. 28×28 by default — small enough to sit in toolbars and
 * row actions without dominating the visual weight. */

type Variant = 'default' | 'danger'

const props = withDefaults(
  defineProps<{
    variant?: Variant
    disabled?: boolean
    label?: string
    active?: boolean
  }>(),
  {
    variant: 'default',
    disabled: false,
    label: '',
    active: false
  }
)

const classes = computed(() => {
  const base =
    'inline-flex items-center justify-center rounded-[var(--radius-sm)] size-7 ' +
    'transition-colors duration-[var(--motion-fast)] ease-[var(--ease-out)] ' +
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
  </button>
</template>

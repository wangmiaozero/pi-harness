<script setup lang="ts">
import { computed } from 'vue'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

const props = withDefaults(
  defineProps<{
    variant?: Variant
    size?: Size
    disabled?: boolean
    loading?: boolean
    type?: 'button' | 'submit' | 'reset'
  }>(),
  {
    variant: 'secondary',
    size: 'md',
    disabled: false,
    loading: false,
    type: 'button'
  }
)

/* Resting buttons keep a visible fill and border so they read as controls on white. */
const classes = computed(() => {
  const base =
    'ui-button relative inline-flex items-center justify-center gap-1.5 align-middle rounded-[8px] border font-medium select-none whitespace-nowrap ' +
    'transition-colors duration-[var(--motion-fast)] ease-[var(--ease-out)] ' +
    'focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] ' +
    'disabled:pointer-events-none disabled:opacity-45'

  const sizes = {
    sm: 'h-[var(--height-button)] px-2 text-[12px]',
    md: 'h-[var(--height-button-md)] px-2.5 text-[12.5px]'
  }

  const variants: Record<Variant, string> = {
    primary:
      'border-[color-mix(in_srgb,var(--text-primary)_22%,var(--bg-surface))] bg-[color-mix(in_srgb,var(--text-primary)_14%,var(--bg-surface))] text-[var(--text-primary)] hover:bg-[color-mix(in_srgb,var(--text-primary)_20%,var(--bg-surface))]',
    secondary:
      'border-[color-mix(in_srgb,var(--text-primary)_16%,var(--bg-surface))] bg-[color-mix(in_srgb,var(--text-primary)_6%,var(--bg-surface))] text-[var(--text-primary)] hover:bg-[color-mix(in_srgb,var(--text-primary)_10%,var(--bg-surface))]',
    ghost:
      'border-transparent bg-transparent text-[var(--text-secondary)] hover:bg-[color-mix(in_srgb,var(--text-primary)_6%,var(--bg-surface))] hover:text-[var(--text-primary)]',
    danger:
      'border-transparent bg-[var(--error-tint)] text-[var(--error)] hover:bg-[color-mix(in_srgb,var(--error)_14%,var(--bg-surface))]'
  }
  return [base, sizes[props.size], variants[props.variant]].join(' ')
})
</script>

<template>
  <button
    :type="type"
    :class="classes"
    :data-variant="variant"
    :disabled="disabled || loading"
    :aria-busy="loading || undefined"
  >
    <span
      v-if="loading"
      class="absolute inline-block size-3 animate-spin rounded-full border-[1.5px] border-current border-r-transparent"
    />
    <span class="inline-flex items-center gap-1.5" :class="loading ? 'invisible' : ''">
      <slot />
    </span>
  </button>
</template>

<style scoped>
.ui-button[aria-pressed='true'] {
  border-color: color-mix(in srgb, var(--text-primary) 22%, var(--bg-surface));
  background: color-mix(in srgb, var(--text-primary) 14%, var(--bg-surface));
  color: var(--text-primary);
}
</style>

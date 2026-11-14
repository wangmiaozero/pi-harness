<script setup lang="ts">
import { computed, inject } from 'vue'
import { flatButtonStyle } from './button-style'

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

const flat = inject(flatButtonStyle, false)

const classes = computed(() => {
  const base =
    'ui-button relative inline-flex items-center justify-center gap-1.5 align-middle font-medium select-none whitespace-nowrap ' +
    'transition-colors duration-[var(--motion-fast)] ease-[var(--ease-out)] ' +
    'focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] ' +
    'disabled:pointer-events-none disabled:opacity-45'

  const sizes = {
    sm: 'h-[var(--height-button)] px-2 text-[12px]',
    md: 'h-[var(--height-button-md)] px-2.5 text-[12.5px]'
  }

  const flatVariants: Record<Variant, string> = {
    primary:
      'bg-[var(--bg-hover)] text-[var(--text-primary)] hover:bg-[color-mix(in_srgb,var(--text-primary)_13%,var(--bg-hover))]',
    secondary: 'bg-transparent text-[var(--text-primary)] hover:bg-[var(--bg-hover)]',
    ghost:
      'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
    danger:
      'bg-[var(--error-tint)] text-[var(--error)] hover:bg-[color-mix(in_srgb,var(--error)_14%,var(--bg-surface))]'
  }
  const variants: Record<Variant, string> = {
    primary:
      'bg-[var(--accent-solid)] text-white hover:bg-[var(--accent-solid-hover)] active:bg-[var(--accent-solid-active)] disabled:bg-[color-mix(in_srgb,var(--accent-solid)_55%,var(--bg-surface))] disabled:opacity-100',
    secondary:
      'border border-[var(--control-border)] bg-[var(--control-bg)] text-[var(--text-primary)] shadow-[var(--control-shadow)] hover:border-[var(--control-border-hover)] hover:bg-[var(--control-bg-hover)]',
    ghost: flatVariants.ghost,
    danger:
      'border border-[var(--error)]/30 bg-[var(--error-tint)] text-[var(--error)] hover:border-[var(--error)]/45 hover:bg-[var(--error)]/20'
  }
  return [
    base,
    sizes[props.size],
    flat
      ? 'rounded-[8px] aria-pressed:bg-[var(--bg-hover)] aria-pressed:text-[var(--text-primary)]'
      : 'rounded-[var(--radius-sm)]',
    (flat ? flatVariants : variants)[props.variant]
  ].join(' ')
})
</script>

<template>
  <button
    :type="type"
    :class="classes"
    :data-variant="variant"
    :data-flat="flat || undefined"
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

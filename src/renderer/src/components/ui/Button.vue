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

/* Mac-style button. Compact, low-saturation, no shadows. Hover only changes
 * background + foreground — never scale, never bounce. */
const classes = computed(() => {
  const base =
    'relative inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-sm)] font-medium select-none whitespace-nowrap ' +
    'transition-colors duration-[var(--motion-fast)] ease-[var(--ease-out)] ' +
    'focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] ' +
    'disabled:opacity-45'

  const sizes = {
    sm: 'h-[var(--height-button)] px-2 text-[12px]',
    md: 'h-[var(--height-button-md)] px-2.5 text-[12.5px]'
  }

  const variants: Record<Variant, string> = {
    primary:
      'bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] active:bg-[var(--accent-active)] ' +
      'shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]',
    secondary:
      'bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-default)] ' +
      'hover:bg-[var(--bg-hover)] hover:border-[var(--border-strong)]',
    ghost:
      'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
    danger:
      'bg-[var(--error-tint)] text-[var(--error)] border border-[var(--error)]/30 ' +
      'hover:bg-[var(--error)]/20 hover:border-[var(--error)]/45'
  }
  return [base, sizes[props.size], variants[props.variant]].join(' ')
})
</script>

<template>
  <button :type="type" :class="classes" :disabled="disabled || loading">
    <span
      v-if="loading"
      class="absolute inline-block size-3 animate-spin rounded-full border-[1.5px] border-current border-r-transparent"
    />
    <span class="inline-flex items-center gap-1.5" :class="loading ? 'invisible' : ''">
      <slot />
    </span>
  </button>
</template>

<script setup lang="ts">
import { computed, useAttrs, useId } from 'vue'

defineOptions({ inheritAttrs: false })

const model = defineModel<string>({ default: '' })

const props = defineProps<{
  label?: string
  placeholder?: string
  type?: string
  disabled?: boolean
  mono?: boolean
  hint?: string
  error?: string
  layout?: 'stacked' | 'row'
}>()

const attrs = useAttrs()
const controlId = useId()
const inputId = computed(() => String((attrs.id as string | undefined) ?? controlId))

const inputClasses = computed(() => {
  const base =
    'h-[var(--height-input)] w-full rounded-[var(--radius-sm)] border border-[var(--control-border)] ' +
    'bg-[var(--control-bg)] px-2.5 text-[13px] text-[var(--text-primary)] shadow-[var(--control-shadow)] ' +
    'placeholder:text-[var(--control-placeholder)] ' +
    'transition-[background-color,border-color,box-shadow] duration-[var(--motion-fast)] ease-[var(--ease-out)] ' +
    'hover:border-[var(--control-border-hover)] hover:bg-[var(--control-bg-hover)] ' +
    'focus:border-[var(--accent)] focus:bg-[var(--control-bg-hover)] focus:outline-none focus:shadow-[var(--focus-ring)] ' +
    'disabled:cursor-not-allowed disabled:border-[var(--border-subtle)] disabled:bg-[var(--control-bg-disabled)] disabled:text-[var(--text-disabled)] disabled:shadow-none'
  return props.mono ? `${base} font-[family-name:var(--font-mono)] text-[12px]` : base
})

const fieldClasses = computed(() =>
  props.layout === 'row'
    ? 'grid grid-cols-[132px_minmax(0,1fr)] items-center gap-x-4 gap-y-1 px-3 py-2'
    : 'flex flex-col gap-1'
)
</script>

<template>
  <div :class="fieldClasses">
    <label
      v-if="label"
      :for="inputId"
      class="text-[11.5px] font-medium text-[var(--text-secondary)]"
    >
      {{ label }}
    </label>
    <input
      :id="inputId"
      v-model="model"
      v-bind="$attrs"
      :type="type ?? 'text'"
      :placeholder="placeholder"
      :disabled="disabled"
      :aria-invalid="error ? 'true' : undefined"
      :class="inputClasses"
    />
    <p
      v-if="error || hint"
      class="text-[10.5px] leading-snug"
      :class="[
        error ? 'text-[var(--error)]' : 'text-[var(--text-tertiary)]',
        layout === 'row' ? 'col-start-2' : ''
      ]"
    >
      {{ error || hint }}
    </p>
  </div>
</template>

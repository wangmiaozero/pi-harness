<script setup lang="ts">
import { computed, useAttrs, useId } from 'vue'
import { Eye, EyeOff } from '@lucide/vue'

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
  revealable?: boolean
  revealed?: boolean
  revealLoading?: boolean
  revealLabel?: string
  hideLabel?: string
}>()

const emit = defineEmits<{ 'reveal-toggle': [] }>()

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
    <div class="relative min-w-0">
      <input
        :id="inputId"
        v-model="model"
        v-bind="$attrs"
        :type="revealable ? (revealed ? 'text' : 'password') : (type ?? 'text')"
        :placeholder="placeholder"
        :disabled="disabled"
        :aria-invalid="error ? 'true' : undefined"
        :class="[inputClasses, revealable ? 'pr-9' : '']"
      />
      <button
        v-if="revealable"
        type="button"
        class="absolute right-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] disabled:pointer-events-none disabled:opacity-50"
        :aria-label="revealed ? hideLabel : revealLabel"
        :title="revealed ? hideLabel : revealLabel"
        :disabled="revealLoading"
        @click="emit('reveal-toggle')"
      >
        <span
          v-if="revealLoading"
          class="inline-block size-3 animate-spin rounded-full border-[1.5px] border-current border-r-transparent"
        />
        <EyeOff v-else-if="revealed" class="size-3.5" :stroke-width="1.75" />
        <Eye v-else class="size-3.5" :stroke-width="1.75" />
      </button>
    </div>
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

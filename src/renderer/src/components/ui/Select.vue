<script setup lang="ts">
import { computed, useAttrs, useId } from 'vue'
import { ChevronDown } from '@lucide/vue'

const model = defineModel<string>({ default: '' })

defineOptions({ inheritAttrs: false })

const props = defineProps<{
  label?: string
  disabled?: boolean
  options: { value: string; label: string }[]
  hint?: string
  error?: string
  layout?: 'stacked' | 'row'
}>()

const attrs = useAttrs()
const controlId = useId()
const selectId = computed(() => String((attrs.id as string | undefined) ?? controlId))

const selectClasses = computed(() => {
  const base =
    'h-[var(--height-select)] w-full appearance-none rounded-[var(--radius-sm)] border border-[var(--control-border)] ' +
    'bg-[var(--control-bg)] pl-2.5 pr-7 text-[13px] text-[var(--text-primary)] shadow-[var(--control-shadow)] ' +
    'transition-[background-color,border-color,box-shadow] duration-[var(--motion-fast)] ease-[var(--ease-out)] ' +
    'hover:border-[var(--control-border-hover)] hover:bg-[var(--control-bg-hover)] ' +
    'focus:border-[var(--accent)] focus:bg-[var(--control-bg-hover)] focus:outline-none focus:shadow-[var(--focus-ring)] ' +
    'disabled:cursor-not-allowed disabled:border-[var(--border-subtle)] disabled:bg-[var(--control-bg-disabled)] disabled:text-[var(--text-disabled)] disabled:shadow-none'
  return base
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
      :for="selectId"
      class="text-[11.5px] font-medium text-[var(--text-secondary)]"
    >
      {{ label }}
    </label>
    <div class="relative">
      <select
        :id="selectId"
        v-model="model"
        v-bind="$attrs"
        :disabled="disabled"
        :aria-invalid="error ? 'true' : undefined"
        :class="selectClasses"
      >
        <option v-for="opt in options" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </option>
      </select>
      <ChevronDown
        aria-hidden="true"
        class="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 text-[var(--text-tertiary)]"
        :stroke-width="1.75"
      />
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

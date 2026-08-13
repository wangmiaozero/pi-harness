<script setup lang="ts">
import { computed, useAttrs, useId } from 'vue'

defineOptions({ inheritAttrs: false })

const model = defineModel<string>({ default: '' })
defineProps<{
  label?: string
  placeholder?: string
  disabled?: boolean
  mono?: boolean
  hint?: string
  error?: string
  rows?: number
}>()

const attrs = useAttrs()
const controlId = useId()
const textareaId = computed(() => String((attrs.id as string | undefined) ?? controlId))
</script>

<template>
  <div class="flex flex-col gap-1">
    <label
      v-if="label"
      :for="textareaId"
      class="text-[11.5px] font-medium text-[var(--text-secondary)]"
    >
      {{ label }}
    </label>
    <textarea
      :id="textareaId"
      v-model="model"
      v-bind="$attrs"
      :rows="rows ?? 3"
      :placeholder="placeholder"
      :disabled="disabled"
      :aria-invalid="error ? 'true' : undefined"
      class="min-h-[68px] w-full resize-y rounded-[var(--radius-sm)] border border-[var(--control-border)] bg-[var(--control-bg)] px-2.5 py-2 text-[12.5px] leading-relaxed text-[var(--text-primary)] shadow-[var(--control-shadow)] transition-[background-color,border-color,box-shadow] duration-[var(--motion-fast)] ease-[var(--ease-out)] placeholder:text-[var(--control-placeholder)] hover:border-[var(--control-border-hover)] hover:bg-[var(--control-bg-hover)] focus:border-[var(--accent)] focus:bg-[var(--control-bg-hover)] focus:outline-none focus:shadow-[var(--focus-ring)] disabled:cursor-not-allowed disabled:border-[var(--border-subtle)] disabled:bg-[var(--control-bg-disabled)] disabled:text-[var(--text-disabled)] disabled:shadow-none"
      :class="mono ? 'font-[family-name:var(--font-mono)] text-[11px]' : ''"
    />
    <p
      v-if="error || hint"
      class="text-[10.5px] leading-snug"
      :class="error ? 'text-[var(--error)]' : 'text-[var(--text-tertiary)]'"
    >
      {{ error || hint }}
    </p>
  </div>
</template>

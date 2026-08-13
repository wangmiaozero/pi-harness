<script setup lang="ts">
import { computed } from 'vue'

const model = defineModel<boolean>({ default: false })

const props = defineProps<{
  disabled?: boolean
  label?: string
}>()

function toggle() {
  if (props.disabled) return
  model.value = !model.value
}

const trackClasses = computed(() =>
  model.value
    ? 'bg-[var(--accent)] border-[var(--accent)]'
    : 'bg-[var(--bg-surface)] border-[var(--border-strong)]'
)

const thumbStyle = computed(() => ({
  transform: model.value ? 'translateX(11px)' : 'translateX(1px)'
}))
</script>

<template>
  <button
    type="button"
    role="switch"
    :aria-checked="model"
    :aria-label="label"
    :disabled="disabled"
    class="relative inline-flex h-[var(--height-switch-track)] w-[28px] shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-[var(--motion-fast)] ease-[var(--ease-out)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-45"
    :class="trackClasses"
    @click="toggle"
  >
    <span
      class="pointer-events-none absolute top-1/2 size-[var(--height-switch-thumb)] -translate-y-1/2 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.3)] transition-transform duration-[var(--motion-base)] ease-[var(--ease-out)]"
      :style="thumbStyle"
    />
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const model = defineModel<number>({ required: true })
const props = withDefaults(
  defineProps<{
    label: string
    min: number
    max: number
    step?: number
    disabled?: boolean
    valueText?: string
  }>(),
  { step: 1, valueText: undefined }
)
const progress = computed(() =>
  Math.min(100, Math.max(0, ((model.value - props.min) / (props.max - props.min)) * 100))
)
function update(event: Event): void {
  if (props.disabled) return
  const value = (event.target as HTMLInputElement).valueAsNumber
  if (Number.isFinite(value)) model.value = Math.min(props.max, Math.max(props.min, value))
}
</script>

<template>
  <span class="flex w-full min-w-0 items-center gap-3" :class="{ 'opacity-45': disabled }">
    <input
      class="settings-range min-w-0 flex-1 cursor-pointer focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] disabled:cursor-not-allowed"
      type="range"
      :value="model"
      :min="min"
      :max="max"
      :step="step"
      :aria-label="label"
      :aria-valuetext="valueText ?? String(model)"
      :disabled="disabled"
      :style="{ '--range-progress': `${progress}%` }"
      @input="update"
    />
    <output
      class="min-w-[6ch] shrink-0 text-right text-[12px] tabular-nums text-[var(--text-secondary)]"
      aria-hidden="true"
    >
      {{ valueText ?? model }}
    </output>
  </span>
</template>

<style scoped>
.settings-range {
  appearance: none;
  height: 6px;
  margin-block: 9px;
  border-radius: 999px;
  background: linear-gradient(
    to right,
    var(--accent-solid) 0% var(--range-progress),
    var(--border-strong) var(--range-progress) 100%
  );
}
.settings-range::-webkit-slider-thumb {
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid var(--accent-solid);
  background: var(--bg-surface);
  box-shadow: 0 1px 3px #0003;
}
.settings-range::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid var(--accent-solid);
  background: var(--bg-surface);
}
</style>

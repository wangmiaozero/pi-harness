<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { Check, ChevronDown } from '@lucide/vue'

const model = defineModel<string>({ default: '' })

const props = withDefaults(
  defineProps<{
    label?: string
    disabled?: boolean
    options: { value: string; label: string; swatch?: string }[]
    hint?: string
    error?: string
    layout?: 'stacked' | 'row'
    placeholder?: string
    mono?: boolean
  }>(),
  {
    label: '',
    hint: '',
    error: '',
    disabled: false,
    layout: 'stacked',
    placeholder: ''
  }
)

const selectId = useId()
const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)
const triggerRef = ref<HTMLButtonElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
const panelStyle = ref<Record<string, string>>({})

const selected = computed(() => props.options.find((o) => o.value === model.value))

const fieldClasses = computed(() =>
  props.layout === 'row'
    ? 'grid grid-cols-[132px_minmax(0,1fr)] items-center gap-x-4 gap-y-1 px-3 py-2'
    : 'flex flex-col gap-1'
)

const triggerClasses = computed(() => {
  const base =
    'inline-flex h-[var(--height-select)] w-full items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-[var(--control-border)] ' +
    'bg-[var(--control-bg)] px-2.5 text-left text-[13px] text-[var(--text-primary)] shadow-[var(--control-shadow)] ' +
    'transition-[background-color,border-color,box-shadow] duration-[var(--motion-fast)] ease-[var(--ease-out)] ' +
    'hover:border-[var(--control-border-hover)] hover:bg-[var(--control-bg-hover)] ' +
    'focus:border-[var(--accent)] focus:bg-[var(--control-bg-hover)] focus:outline-none focus:shadow-[var(--focus-ring)] ' +
    'disabled:cursor-not-allowed disabled:border-[var(--border-subtle)] disabled:bg-[var(--control-bg-disabled)] disabled:text-[var(--text-disabled)] disabled:shadow-none'
  return props.mono ? `${base} font-[family-name:var(--font-mono)] text-[12px]` : base
})

function syncPanel() {
  const el = triggerRef.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const maxH = 240
  const gap = 4
  const spaceBelow = window.innerHeight - r.bottom - 8
  const openUp = spaceBelow < 120 && r.top > spaceBelow
  const availableHeight = openUp ? r.top - gap - 8 : spaceBelow
  panelStyle.value = {
    top: openUp ? `${Math.round(r.top - gap)}px` : `${Math.round(r.bottom + gap)}px`,
    left: `${Math.round(r.left)}px`,
    width: `${Math.round(r.width)}px`,
    maxHeight: `${Math.max(80, Math.min(maxH, availableHeight))}px`,
    transform: openUp ? 'translateY(-100%)' : 'none'
  }
}

function toggle() {
  if (props.disabled) return
  if (open.value) {
    open.value = false
    return
  }
  syncPanel()
  open.value = true
}

function pick(value: string) {
  model.value = value
  open.value = false
}

function onDocPointer(e: PointerEvent) {
  const t = e.target as Node
  if (rootRef.value?.contains(t) || panelRef.value?.contains(t)) return
  open.value = false
}

function onKey(e: KeyboardEvent) {
  if (!open.value) return
  if (e.key === 'Escape') {
    e.stopPropagation()
    open.value = false
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointer, true)
  document.addEventListener('keydown', onKey, true)
  window.addEventListener('resize', syncPanel)
  window.addEventListener('scroll', syncPanel, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointer, true)
  document.removeEventListener('keydown', onKey, true)
  window.removeEventListener('resize', syncPanel)
  window.removeEventListener('scroll', syncPanel, true)
})

watch(open, (v) => {
  if (v) syncPanel()
})
</script>

<template>
  <div ref="rootRef" :class="fieldClasses">
    <label
      v-if="label"
      :for="selectId"
      class="text-[11.5px] font-medium text-[var(--text-secondary)]"
    >
      {{ label }}
    </label>
    <button
      :id="selectId"
      ref="triggerRef"
      type="button"
      :class="triggerClasses"
      :disabled="disabled"
      :aria-expanded="open"
      aria-haspopup="listbox"
      :aria-invalid="error ? 'true' : undefined"
      @click="toggle"
    >
      <span
        class="min-w-0 flex-1 truncate"
        :class="selected ? '' : 'text-[var(--control-placeholder)]'"
      >
        <span
          v-if="selected?.swatch"
          class="mr-1.5 inline-block size-2.5 rounded-full align-[-1px]"
          :style="{ backgroundColor: selected.swatch }"
        />
        {{ selected?.label || placeholder || '' }}
      </span>
      <ChevronDown
        aria-hidden="true"
        class="size-3 shrink-0 text-[var(--text-tertiary)]"
        :stroke-width="1.75"
      />
    </button>
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
    <Teleport to="body">
      <div
        v-if="open"
        ref="panelRef"
        role="listbox"
        class="pointer-events-auto fixed z-[110] overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] p-1 shadow-[var(--shadow-popover)]"
        :style="panelStyle"
        @pointerdown.stop
      >
        <button
          v-for="opt in options"
          :key="opt.value"
          type="button"
          role="option"
          class="flex w-full items-center justify-between gap-2 rounded-[4px] px-2 py-[6px] text-left text-[12.5px] text-[var(--text-primary)] outline-none hover:bg-[var(--bg-hover)]"
          :class="opt.value === model ? 'bg-[var(--accent-tint)] text-[var(--accent)]' : ''"
          :aria-selected="opt.value === model"
          @mousedown.prevent="pick(opt.value)"
        >
          <span
            class="min-w-0 truncate"
            :class="mono ? 'font-[family-name:var(--font-mono)] text-[12px]' : ''"
          >
            <span
              v-if="opt.swatch"
              class="mr-1.5 inline-block size-2.5 rounded-full align-[-1px]"
              :style="{ backgroundColor: opt.swatch }"
            />
            {{ opt.label }}
          </span>
          <Check
            v-if="opt.value === model"
            class="size-3 shrink-0 text-[var(--accent)]"
            :stroke-width="2"
          />
        </button>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { Check, ChevronDown } from '@lucide/vue'

const model = defineModel<string>({ default: '' })

const props = withDefaults(
  defineProps<{
    label?: string
    placeholder?: string
    hint?: string
    error?: string
    disabled?: boolean
    mono?: boolean
    options?: { value: string; label: string; hint?: string }[]
  }>(),
  {
    label: '',
    placeholder: '',
    hint: '',
    error: '',
    disabled: false,
    options: () => []
  }
)

const inputId = useId()
const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
const panelStyle = ref<Record<string, string>>({})

const filtered = computed(() => {
  const q = model.value.trim().toLowerCase()
  if (!q) return props.options
  return props.options.filter(
    (o) =>
      o.value.toLowerCase().includes(q) ||
      o.label.toLowerCase().includes(q) ||
      (o.hint?.toLowerCase().includes(q) ?? false)
  )
})

function syncPanel() {
  const el = rootRef.value?.querySelector('input')
  if (!el) return
  const r = el.getBoundingClientRect()
  panelStyle.value = {
    top: `${Math.round(r.bottom + 4)}px`,
    left: `${Math.round(r.left)}px`,
    width: `${Math.round(r.width)}px`
  }
}

function showPanel() {
  if (props.disabled || props.options.length === 0) return
  syncPanel()
  open.value = true
}

function pick(opt: { value: string }) {
  model.value = opt.value
  open.value = false
}

function onDocPointer(e: PointerEvent) {
  const t = e.target as Node
  if (rootRef.value?.contains(t) || panelRef.value?.contains(t)) return
  open.value = false
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointer, true)
  window.addEventListener('resize', syncPanel)
  window.addEventListener('scroll', syncPanel, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointer, true)
  window.removeEventListener('resize', syncPanel)
  window.removeEventListener('scroll', syncPanel, true)
})

watch(open, (v) => {
  if (v) syncPanel()
})

const inputClasses = computed(() => {
  const base =
    'h-[var(--height-input)] w-full rounded-[var(--radius-sm)] border border-[var(--control-border)] ' +
    'bg-[var(--control-bg)] py-0 pl-2.5 pr-7 text-[13px] text-[var(--text-primary)] shadow-[var(--control-shadow)] ' +
    'placeholder:text-[var(--control-placeholder)] ' +
    'transition-[background-color,border-color,box-shadow] duration-[var(--motion-fast)] ease-[var(--ease-out)] ' +
    'hover:border-[var(--control-border-hover)] hover:bg-[var(--control-bg-hover)] ' +
    'focus:border-[var(--accent)] focus:bg-[var(--control-bg-hover)] focus:outline-none focus:shadow-[var(--focus-ring)] ' +
    'disabled:cursor-not-allowed disabled:border-[var(--border-subtle)] disabled:bg-[var(--control-bg-disabled)] disabled:text-[var(--text-disabled)] disabled:shadow-none'
  return props.mono ? `${base} font-[family-name:var(--font-mono)] text-[12px]` : base
})
</script>

<template>
  <div ref="rootRef" class="flex flex-col gap-1">
    <label
      v-if="label"
      :for="inputId"
      class="text-[11.5px] font-medium text-[var(--text-secondary)]"
    >
      {{ label }}
    </label>
    <div class="relative">
      <input
        :id="inputId"
        v-model="model"
        type="text"
        :placeholder="placeholder"
        :disabled="disabled"
        :aria-invalid="error ? 'true' : undefined"
        :aria-expanded="open"
        autocomplete="off"
        :class="inputClasses"
        @focus="showPanel"
        @input="showPanel"
      />
      <button
        type="button"
        class="absolute right-1.5 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
        tabindex="-1"
        :disabled="disabled"
        @mousedown.prevent="open ? (open = false) : showPanel()"
      >
        <ChevronDown class="size-3" :stroke-width="1.75" />
      </button>
    </div>
    <p
      v-if="error || hint"
      class="text-[10.5px] leading-snug"
      :class="error ? 'text-[var(--error)]' : 'text-[var(--text-tertiary)]'"
    >
      {{ error || hint }}
    </p>
    <Teleport to="body">
      <div
        v-if="open && filtered.length > 0"
        ref="panelRef"
        data-combobox-panel
        class="pointer-events-auto fixed z-[110] overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] p-1 shadow-[var(--shadow-popover)]"
        :style="panelStyle"
        @pointerdown.stop
      >
        <button
          v-for="opt in filtered"
          :key="opt.value"
          type="button"
          class="flex w-full items-center justify-between gap-2 rounded-[4px] px-2 py-[6px] text-left text-[12.5px] text-[var(--text-primary)] outline-none hover:bg-[var(--bg-hover)]"
          :class="opt.value === model ? 'bg-[var(--accent-tint)] text-[var(--accent)]' : ''"
          @mousedown.prevent="pick(opt)"
        >
          <span
            class="min-w-0 truncate"
            :class="mono ? 'font-[family-name:var(--font-mono)] text-[12px]' : ''"
          >
            {{ opt.label }}
          </span>
          <span v-if="opt.hint" class="shrink-0 text-[11px] text-[var(--text-tertiary)]">
            {{ opt.hint }}
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

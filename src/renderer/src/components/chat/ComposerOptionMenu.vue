<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, type Component } from 'vue'
import { Check } from '@lucide/vue'

const model = defineModel<string>({ required: true })
const emit = defineEmits<{ interact: [] }>()
const props = withDefaults(
  defineProps<{
    label: string
    icon?: Component
    options: Array<{ value: string; label: string; description: string }>
    disabled?: boolean
    menuWidth?: number
  }>(),
  { icon: undefined, disabled: false, menuWidth: 280 }
)

const open = ref(false)
const trigger = ref<HTMLButtonElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const panelStyle = ref<Record<string, string>>({})
const selected = computed(() => props.options.find((option) => option.value === model.value))

function syncPanel() {
  const rect = trigger.value?.getBoundingClientRect()
  if (!rect) return
  const width = Math.min(props.menuWidth, window.innerWidth - 16)
  const left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))
  const openUp = rect.top > 190
  panelStyle.value = {
    width: `${width}px`,
    left: `${Math.round(left)}px`,
    top: openUp ? `${Math.round(rect.top - 6)}px` : `${Math.round(rect.bottom + 6)}px`,
    transform: openUp ? 'translateY(-100%)' : 'none',
    maxHeight: `${Math.max(120, Math.min(320, openUp ? rect.top - 18 : window.innerHeight - rect.bottom - 18))}px`
  }
}

function toggle() {
  if (props.disabled) return
  emit('interact')
  if (!open.value) syncPanel()
  open.value = !open.value
}

function pick(value: string) {
  emit('interact')
  model.value = value
  open.value = false
}

function onPointerDown(event: PointerEvent) {
  const target = event.target as Node
  if (trigger.value?.contains(target) || panel.value?.contains(target)) return
  open.value = false
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') open.value = false
}

onMounted(() => {
  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('keydown', onKeydown, true)
  window.addEventListener('resize', syncPanel)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerDown, true)
  document.removeEventListener('keydown', onKeydown, true)
  window.removeEventListener('resize', syncPanel)
})
</script>

<template>
  <button
    ref="trigger"
    type="button"
    class="inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2.5 text-[12px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-45"
    :class="open ? 'bg-[var(--bg-hover)] text-[var(--text-primary)]' : ''"
    :disabled="disabled"
    :title="label"
    :aria-label="label"
    :aria-expanded="open"
    aria-haspopup="listbox"
    @click="toggle"
  >
    <component :is="icon" v-if="icon" aria-hidden="true" class="size-3.5" :stroke-width="1.8" />
    <span>{{ selected?.label ?? model }}</span>
  </button>

  <Teleport to="body">
    <div
      v-if="open"
      ref="panel"
      role="listbox"
      class="fixed z-[120] overflow-y-auto rounded-[9px] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] p-1 shadow-[var(--shadow-popover)]"
      :style="panelStyle"
      @pointerdown.stop
    >
      <button
        v-for="option in options"
        :key="option.value"
        type="button"
        role="option"
        class="grid w-full grid-cols-[12px_minmax(70px,1fr)_auto] items-center gap-2 rounded-[6px] px-2.5 py-2 text-left text-[12px] text-[var(--text-secondary)] outline-none hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        :class="
          option.value === model
            ? 'bg-[var(--bg-hover)] font-medium text-[var(--text-primary)]'
            : ''
        "
        :aria-selected="option.value === model"
        @mousedown.prevent="pick(option.value)"
      >
        <Check
          v-if="option.value === model"
          aria-hidden="true"
          class="size-3 text-[var(--accent)]"
          :stroke-width="2.2"
        />
        <span v-else />
        <span class="font-[family-name:var(--font-mono)]">{{ option.label }}</span>
        <span class="text-right text-[11px] font-normal text-[var(--text-tertiary)]">
          {{ option.description }}
        </span>
      </button>
    </div>
  </Teleport>
</template>

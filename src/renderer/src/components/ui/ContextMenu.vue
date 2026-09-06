<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Check } from '@lucide/vue'

type ContextMenuEntry =
  | {
      type: 'action'
      id: string
      label: string
      disabled?: boolean
      danger?: boolean
      checked?: boolean
      inset?: boolean
      value?: string
      testId?: string
    }
  | { type: 'separator'; id: string }
  | { type: 'label'; id: string; label: string }

const props = withDefaults(
  defineProps<{
    open: boolean
    x: number
    y: number
    label: string
    entries: ContextMenuEntry[]
    width?: number
    testId?: string
  }>(),
  { width: 212, testId: undefined }
)

const emit = defineEmits<{
  close: []
  select: [id: string, value?: string]
}>()

const menuElement = ref<HTMLElement | null>(null)
const position = ref({ x: 8, y: 8 })
const menuStyle = computed(() => ({
  left: `${position.value.x}px`,
  top: `${position.value.y}px`,
  width: `${props.width}px`
}))

async function syncPosition() {
  if (!props.open) return
  position.value = { x: props.x, y: props.y }
  await nextTick()
  const element = menuElement.value
  if (!element) return
  const rect = element.getBoundingClientRect()
  position.value = {
    x: Math.max(8, Math.min(props.x, window.innerWidth - rect.width - 8)),
    y: Math.max(8, Math.min(props.y, window.innerHeight - rect.height - 8))
  }
  await nextTick()
  element.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus()
}

function select(entry: Extract<ContextMenuEntry, { type: 'action' }>) {
  if (entry.disabled) return
  emit('select', entry.id, entry.value)
  emit('close')
}

function onDocumentPointer(event: PointerEvent) {
  if (!props.open || menuElement.value?.contains(event.target as Node)) return
  emit('close')
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (!props.open) return
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
    return
  }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  const items = Array.from(
    menuElement.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []
  )
  if (!items.length) return
  event.preventDefault()
  const current = items.indexOf(document.activeElement as HTMLButtonElement)
  const delta = event.key === 'ArrowDown' ? 1 : -1
  items[(current + delta + items.length) % items.length]?.focus()
}

function close() {
  emit('close')
}

watch(() => [props.open, props.x, props.y, props.entries] as const, syncPosition, {
  flush: 'post'
})

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointer, true)
  document.addEventListener('keydown', onDocumentKeydown, true)
  window.addEventListener('blur', close)
  window.addEventListener('resize', close)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointer, true)
  document.removeEventListener('keydown', onDocumentKeydown, true)
  window.removeEventListener('blur', close)
  window.removeEventListener('resize', close)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      ref="menuElement"
      role="menu"
      class="ui-context-menu fixed z-[130] overflow-y-auto border border-[var(--border-default)] bg-[var(--bg-surface-raised)] p-1 shadow-[var(--shadow-popover)]"
      :style="menuStyle"
      :aria-label="label"
      :data-testid="testId"
      @contextmenu.prevent
      @pointerdown.stop
    >
      <template v-for="entry in entries" :key="entry.id">
        <div
          v-if="entry.type === 'separator'"
          role="separator"
          class="ui-context-menu__separator mx-1 my-1 h-px bg-[var(--border-subtle)]"
        />
        <div
          v-else-if="entry.type === 'label'"
          class="ui-context-menu__label px-2 pb-1 pt-1.5 text-[10px] font-semibold text-[var(--text-tertiary)]"
        >
          {{ entry.label }}
        </div>
        <button
          v-else
          type="button"
          role="menuitem"
          class="ui-context-menu__item flex min-h-8 w-full items-center gap-2 px-2 text-left text-[12.5px] text-[var(--text-primary)] transition-[color,filter]"
          :class="{
            'ui-context-menu__item--danger': entry.danger,
            'ui-context-menu__item--inset': entry.inset
          }"
          :disabled="entry.disabled"
          :aria-checked="entry.checked === undefined ? undefined : entry.checked"
          :data-testid="entry.testId"
          @click="select(entry)"
        >
          <span v-if="entry.inset" class="flex size-3 shrink-0 items-center justify-center">
            <Check v-if="entry.checked" class="size-3" :stroke-width="2" />
          </span>
          <span class="min-w-0 flex-1 truncate">{{ entry.label }}</span>
        </button>
      </template>
    </div>
  </Teleport>
</template>

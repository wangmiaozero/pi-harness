<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { GripVertical } from '@lucide/vue'
import { moveNavItem, type NavItemId } from '@shared/constants/navigation'

const order = defineModel<NavItemId[]>({ required: true })
const { t } = useI18n()

const dragging = ref<number | null>(null)
const over = ref<number | null>(null)

function onDragStart(event: DragEvent, index: number): void {
  dragging.value = index
  over.value = index
  if (!event.dataTransfer) return
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', String(index))
}

function onDragOver(event: DragEvent, index: number): void {
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  over.value = index
}

function onDrop(event: DragEvent, index: number): void {
  event.preventDefault()
  const from = dragging.value
  dragging.value = null
  over.value = null
  if (from == null) return
  order.value = moveNavItem(order.value, from, index)
}

function onDragEnd(): void {
  dragging.value = null
  over.value = null
}

function onKeydown(event: KeyboardEvent, index: number): void {
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    order.value = moveNavItem(order.value, index, index - 1)
    return
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    order.value = moveNavItem(order.value, index, index + 1)
  }
}
</script>

<template>
  <ol
    data-testid="nav-order-list"
    class="divide-y divide-[var(--border-subtle)] border-t border-[var(--border-subtle)]"
  >
    <li
      v-for="(id, index) in order"
      :key="id"
      data-testid="nav-order-item"
      :data-nav-id="id"
      draggable="true"
      tabindex="0"
      :aria-label="t(`nav.${id}`)"
      :aria-grabbed="dragging === index"
      class="no-drag flex cursor-grab items-center gap-2 px-3 py-[7px] min-h-[30px] text-[12px] text-[var(--text-primary)] outline-none select-none transition-colors duration-[var(--motion-fast)] ease-[var(--ease-out)] focus-visible:shadow-[var(--focus-ring)]"
      :class="
        dragging === index
          ? 'bg-[var(--bg-hover)] opacity-55'
          : over === index && dragging !== null
            ? 'bg-[var(--accent-tint)]'
            : 'hover:bg-[var(--bg-hover)]'
      "
      @dragstart="onDragStart($event, index)"
      @dragover="onDragOver($event, index)"
      @drop="onDrop($event, index)"
      @dragend="onDragEnd"
      @keydown="onKeydown($event, index)"
    >
      <GripVertical
        class="size-3.5 shrink-0 text-[var(--text-tertiary)]"
        :stroke-width="1.75"
        aria-hidden="true"
      />
      <span
        class="w-4 shrink-0 text-center font-[family-name:var(--font-mono)] text-[10.5px] text-[var(--text-tertiary)]"
      >
        {{ index + 1 }}
      </span>
      <span class="min-w-0 flex-1 truncate">{{ t(`nav.${id}`) }}</span>
    </li>
  </ol>
</template>

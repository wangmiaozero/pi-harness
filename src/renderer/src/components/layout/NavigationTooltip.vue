<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useId } from 'vue'
import { Primitive } from 'reka-ui'

defineProps<{ label: string }>()
const id = useId()
const visible = ref(false)
const position = ref({ left: '0px', top: '0px' })
let trigger: HTMLElement | null = null
function show(event: Event): void {
  const target = event.currentTarget
  if (!(target instanceof HTMLElement)) return
  trigger = target
  const box = target.getBoundingClientRect()
  position.value = { left: `${box.right + 6}px`, top: `${box.top + box.height / 2}px` }
  visible.value = true
}
function showKeyboardFocus(event: FocusEvent): void {
  if (event.currentTarget instanceof HTMLElement && event.currentTarget.matches(':focus-visible'))
    show(event)
}
function dismissOutside(event: PointerEvent): void {
  if (visible.value && event.target instanceof Node && !trigger?.contains(event.target))
    visible.value = false
}
function hide(): void {
  visible.value = false
}
onMounted(() => {
  window.addEventListener('pointermove', dismissOutside)
  window.addEventListener('blur', hide)
})
onBeforeUnmount(() => {
  window.removeEventListener('pointermove', dismissOutside)
  window.removeEventListener('blur', hide)
})
</script>

<template>
  <Primitive
    as-child
    :aria-describedby="visible ? id : undefined"
    @pointerenter="show"
    @pointerleave="visible = false"
    @focusin="showKeyboardFocus"
    @focusout="visible = false"
    @pointerdown="visible = false"
    @click="visible = false"
    @keydown.esc="visible = false"
  >
    <slot />
  </Primitive>
  <Teleport to="body">
    <span
      v-if="visible"
      :id="id"
      role="tooltip"
      :style="position"
      class="pointer-events-none fixed z-[100] -translate-y-1/2 whitespace-nowrap rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface-raised)] px-3 py-2 text-sm text-[var(--text-primary)] shadow-lg"
    >
      {{ label }}
    </span>
  </Teleport>
</template>

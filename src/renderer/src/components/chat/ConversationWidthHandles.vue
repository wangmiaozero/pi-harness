<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@renderer/stores/settings'
import { toast } from 'vue-sonner'

/**
 * Draggable edge handles for the centered chat content band.
 *
 * The transcript, empty state, and composer share one preferred max width
 * (`--chat-content-max-width`, set on the chat surface by ChatWindow). Each
 * handle moves the same centered band: 1px of pointer travel widens or
 * narrows the band by 2px. Double-click resets to the default width.
 */
const DEFAULT_WIDTH = 760
const MIN_WIDTH = 560
const MAX_WIDTH = 2400
/** Gutter kept on each side so the handles stay usable. */
const GUTTER = 24

type ResizeSide = 'left' | 'right'

const { t } = useI18n()
const settings = useSettingsStore()
const host = ref<HTMLElement | null>(null)
const dragWidth = ref<number | null>(null)

const preferredWidth = computed(() => {
  const value = settings.settings?.chatContentMaxWidth
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_WIDTH
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(value)))
})
const displayWidth = computed(() => dragWidth.value ?? preferredWidth.value)

interface DragState {
  pointerId: number
  side: ResizeSide
  startWidth: number
  startClientX: number
  paneWidth: number
  currentWidth: number
  frame: number
}

let drag: DragState | null = null

function surfaceOf(): HTMLElement | null {
  return host.value?.closest<HTMLElement>('[data-chat-surface]') ?? null
}

function bandBox(): HTMLElement | null {
  return host.value?.querySelector<HTMLElement>('[data-chat-band-box]') ?? null
}

function clampWidth(width: number, paneWidth: number): number {
  const available = Math.max(0, Math.round(paneWidth) - 2 * GUTTER)
  if (available <= 0) return MIN_WIDTH
  const floor = Math.min(MIN_WIDTH, available)
  return Math.min(available, MAX_WIDTH, Math.max(floor, Math.round(width)))
}

function applyWidth(width: number) {
  surfaceOf()?.style.setProperty('--chat-content-max-width', `${width}px`)
}

function persistWidth(width: number) {
  settings
    .patch({ chatContentMaxWidth: width })
    .then(() => {
      // Hand width control back to the reactive style binding.
      surfaceOf()?.style.removeProperty('--chat-content-max-width')
    })
    .catch((error) => toast.error((error as Error).message))
}

function onPointerDown(side: ResizeSide) {
  return (event: PointerEvent) => {
    if (drag) return
    const paneWidth = bandBox()?.clientWidth ?? window.innerWidth
    drag = {
      pointerId: event.pointerId,
      side,
      startWidth: displayWidth.value,
      startClientX: event.clientX,
      paneWidth,
      currentWidth: displayWidth.value,
      frame: 0
    }
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    document.documentElement.dataset.chatResizing = 'true'
    event.preventDefault()
  }
}

function onPointerMove(event: PointerEvent) {
  const state = drag
  if (!state || state.pointerId !== event.pointerId) return
  const delta = event.clientX - state.startClientX
  const next =
    state.side === 'left'
      ? state.startWidth - 2 * delta
      : state.startWidth + 2 * delta
  state.currentWidth = clampWidth(next, state.paneWidth)
  if (state.frame) return
  state.frame = requestAnimationFrame(() => {
    if (!drag || drag !== state) return
    state.frame = 0
    dragWidth.value = state.currentWidth
    applyWidth(state.currentWidth)
  })
}

function finishDrag(cancelled: boolean) {
  const state = drag
  if (!state) return
  if (state.frame) cancelAnimationFrame(state.frame)
  drag = null
  dragWidth.value = null
  delete document.documentElement.dataset.chatResizing
  if (cancelled) {
    applyWidth(state.startWidth)
    surfaceOf()?.style.removeProperty('--chat-content-max-width')
    return
  }
  const next = state.currentWidth
  applyWidth(next)
  persistWidth(next)
}

function onPointerUp() {
  finishDrag(false)
}

function onPointerCancel() {
  finishDrag(true)
}

function onDoubleClick() {
  applyWidth(DEFAULT_WIDTH)
  persistWidth(DEFAULT_WIDTH)
}

function onKeyDown(event: KeyboardEvent) {
  const side = (event.currentTarget as HTMLElement).dataset.side as ResizeSide | undefined
  if (!side) return
  if (event.key === 'Escape' && drag) {
    event.preventDefault()
    finishDrag(true)
    return
  }
  const step = event.shiftKey ? 32 : 16
  let next: number | null = null
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    const towardWider =
      (side === 'left' && event.key === 'ArrowLeft') ||
      (side === 'right' && event.key === 'ArrowRight')
    next = displayWidth.value + (towardWider ? step : -step)
  } else if (event.key === 'Home') {
    next = DEFAULT_WIDTH
  } else if (event.key === 'End') {
    next = Number.POSITIVE_INFINITY
  }
  if (next === null) return
  event.preventDefault()
  const clamped = clampWidth(next, bandBox()?.clientWidth ?? window.innerWidth)
  applyWidth(clamped)
  persistWidth(clamped)
}

onBeforeUnmount(() => {
  if (drag) finishDrag(true)
})
</script>

<template>
  <div
    ref="host"
    data-testid="chat-width-handles"
    class="pointer-events-none absolute inset-0 z-10"
  >
    <div
      data-chat-band-box
      class="relative mx-4 h-full min-[1080px]:mr-[132px]"
    >
      <div
        v-for="side in (['left', 'right'] as const)"
        :key="side"
        role="separator"
        aria-orientation="vertical"
        :aria-label="t('workspace.resizeChatWidth')"
        :aria-valuemin="MIN_WIDTH"
        :aria-valuemax="MAX_WIDTH"
        :aria-valuenow="displayWidth"
        :aria-valuetext="t('workspace.chatWidth', { width: displayWidth })"
        :data-side="side"
        :data-testid="`chat-width-handle-${side}`"
        tabindex="0"
        class="chat-width-handle pointer-events-auto absolute inset-y-0 w-3 cursor-col-resize touch-none select-none outline-none"
        :class="[
          side === 'left' ? 'chat-width-handle-left' : 'chat-width-handle-right',
          dragWidth !== null ? 'is-resizing' : ''
        ]"
        @pointerdown="onPointerDown(side)"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerCancel"
        @dblclick="onDoubleClick"
        @keydown="onKeyDown"
      />
    </div>
  </div>
</template>

<style scoped>
.chat-width-handle-left {
  left: max(0px, calc((100% - min(100%, var(--chat-content-max-width))) / 2 - 6px));
}

.chat-width-handle-right {
  right: max(0px, calc((100% - min(100%, var(--chat-content-max-width))) / 2 - 6px));
}

.chat-width-handle::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 2px;
  height: 40px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--text-primary) 18%, transparent);
  opacity: 0;
  transform: translate(-50%, -50%);
  transition:
    opacity var(--motion-fast, 120ms) ease-out,
    height var(--motion-fast, 120ms) ease-out,
    background var(--motion-fast, 120ms) ease-out;
}

.chat-width-handle:hover::before,
.chat-width-handle:focus-visible::before,
.chat-width-handle.is-resizing::before {
  opacity: 1;
  height: 56px;
}

.chat-width-handle:focus-visible::before {
  background: color-mix(in srgb, var(--accent) 55%, transparent);
}

:root[data-appearance='light'] .chat-width-handle::before {
  background: color-mix(in srgb, var(--text-primary) 12%, transparent);
}
</style>

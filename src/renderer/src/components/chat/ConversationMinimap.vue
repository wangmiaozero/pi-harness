<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  buildConversationMinimapMarkers,
  shouldRenderConversationMinimap,
  type ConversationMinimapMarker,
  type MinimapMessage
} from './conversation-minimap'

/* Codex-style conversation minimap: a packed stack of dashes on the left edge
 * of the transcript, one per user turn or assistant response. Moving the
 * cursor along the rail magnifies nearby dashes with a macOS-Dock cosine
 * falloff, the nearest turn shows a preview popover, and clicking jumps to
 * that turn. Dashes grow horizontally only, so magnification never shifts the
 * stack layout. */

/* Dock magnification: reach of the falloff and peak growth factor. */
const MAGNIFY_RADIUS = 46
const MAGNIFY_BOOST = 1.3
/* Cursor must be this close to a dash for the popover to pick it. */
const POPOVER_SNAP = 24
const POPOVER_HEIGHT = 132
/* Hide the rail until content actually overflows one viewport. */
const OVERFLOW_EPSILON_PX = 1

const props = defineProps<{
  /** The scrolling transcript element that dashes measure against. */
  target: HTMLElement | null
  messages: MinimapMessage[]
}>()

const emit = defineEmits<{
  /** Fired before a dash jump scrolls, so follow mode can be released. */
  releaseFollow: []
}>()

const { t } = useI18n()
const rail = ref<HTMLElement | null>(null)
const activeId = ref<string | null>(null)
const hovered = ref<{ marker: ConversationMinimapMarker; top: number } | null>(null)

const markerEls = new Map<string, HTMLElement>()
let cachedOffsets: Array<{ id: string; offset: number }> = []
let magnifyCenters: Array<{ id: string; center: number }> = []
let activeIdValue: string | null = null
let overflowsValue = false
const overflows = ref(false)

let moveRaf = 0
let scrollRaf = 0
let resizeRaf = 0
let railResizeRaf = 0
let contentObserver: ResizeObserver | null = null
let railObserver: ResizeObserver | null = null

const markers = computed(() => buildConversationMinimapMarkers(props.messages))
const markerIdentity = computed(() => markers.value.map((marker) => marker.id).join('\u0000'))
const visible = computed(() =>
  shouldRenderConversationMinimap({
    markerCount: markers.value.length,
    overflows: overflows.value
  })
)

function setMarkerEl(id: string, node: unknown) {
  if (node instanceof HTMLElement) markerEls.set(id, node)
  else markerEls.delete(id)
}

/* Cached offsets to avoid O(n) DOM queries on every scroll frame. */
function scanOffsets(): Array<{ id: string; offset: number }> {
  const el = props.target
  if (!el) return []
  const baseTop = el.getBoundingClientRect().top
  const markerIds = new Set(markers.value.map((marker) => marker.id))
  const out: Array<{ id: string; offset: number }> = []
  el.querySelectorAll<HTMLElement>('[data-minimap-id]').forEach((node) => {
    const id = node.dataset.minimapId || ''
    if (!markerIds.has(id)) return
    out.push({
      id,
      offset: node.getBoundingClientRect().top - baseTop + el.scrollTop
    })
  })
  return out
}

function recomputeOffsets() {
  cachedOffsets = scanOffsets()
}

/**
 * Vertical centers of the dashes, in rail-local pixels. Dashes magnify
 * horizontally only, so their centers change with the rail's layout, not with
 * the cursor. Measuring once per layout keeps hover off the critical path.
 */
function measureMagnifyCenters() {
  const centers: Array<{ id: string; center: number }> = []
  // Read-only pass: no style writes, so layout is computed at most once.
  for (const [id, btn] of markerEls) {
    centers.push({ id, center: btn.offsetTop + btn.offsetHeight / 2 })
  }
  centers.sort((a, b) => a.center - b.center)
  magnifyCenters = centers
}

/* Use cached offsets + binary search for O(log n) active tracking. */
function updateActive() {
  const el = props.target
  if (!el) return
  if (cachedOffsets.length === 0) {
    if (activeIdValue !== null) {
      activeIdValue = null
      activeId.value = null
    }
    return
  }
  const anchor = el.scrollTop + el.clientHeight * 0.3
  let lo = 0
  let hi = cachedOffsets.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1
    if (cachedOffsets[mid].offset <= anchor) lo = mid
    else hi = mid - 1
  }
  const id = cachedOffsets[lo].id
  if (id !== activeIdValue) {
    activeIdValue = id
    activeId.value = id
  }
}

function updateOverflow() {
  const el = props.target
  const nowOverflows = el
    ? el.scrollHeight - el.clientHeight > OVERFLOW_EPSILON_PX
    : false
  if (nowOverflows === overflowsValue) return
  overflowsValue = nowOverflows
  overflows.value = nowOverflows
}

function syncLayout() {
  recomputeOffsets()
  updateOverflow()
  measureMagnifyCenters()
  updateActive()
}

function jumpTo(id: string) {
  const el = props.target
  if (!el) return
  const target = scanOffsets().find((entry) => entry.id === id)
  if (!target) return
  // Leaving follow mode is part of the jump, not a side effect: a scroll with
  // no input gesture behind it would otherwise be pinned back to the latest
  // message before the reader saw the turn.
  emit('releaseFollow')
  const reduceMotion =
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  el.scrollTo({
    top: Math.max(0, target.offset - 24),
    behavior: reduceMotion ? 'auto' : 'smooth'
  })
}

/* Dock magnification, applied imperatively so mousemove never re-renders.
 * Dash buttons keep a fixed height, so scaling is layout-stable. Centers come
 * from the cached measurement: writing `--magnify` while reading `offsetTop`
 * in the same loop would force one layout per dash on every hover frame. */
function applyMagnify(cursorY: number | null) {
  if (magnifyCenters.length === 0) {
    // Nothing measured yet (first frame after mount): fall back to a
    // measurement rather than skipping the effect the user asked for.
    measureMagnifyCenters()
  }
  let nearest: { id: string; dist: number; center: number } | null = null
  for (const { id, center } of magnifyCenters) {
    const btn = markerEls.get(id)
    if (!btn) continue
    let scale = 1
    if (cursorY != null) {
      const dist = Math.abs(center - cursorY)
      if (dist < MAGNIFY_RADIUS) {
        scale = 1 + MAGNIFY_BOOST * Math.cos((dist / MAGNIFY_RADIUS) * (Math.PI / 2))
      }
      if (dist <= POPOVER_SNAP && (!nearest || dist < nearest.dist)) {
        nearest = { id, dist, center }
      }
    }
    btn.style.setProperty('--magnify', scale.toFixed(3))
  }
  if (nearest) {
    const marker = markers.value.find((entry) => entry.id === nearest.id)
    const railEl = rail.value
    if (marker && railEl) {
      const top = Math.min(
        Math.max(nearest.center - 36, 0),
        Math.max(railEl.clientHeight - POPOVER_HEIGHT, 0)
      )
      const next = { marker, top }
      if (hovered.value?.marker.id !== marker.id || hovered.value.top !== top) {
        hovered.value = next
      }
      return
    }
  }
  hovered.value = null
}

function onMouseMove(event: MouseEvent) {
  const railEl = rail.value
  if (!railEl) return
  const y = event.clientY - railEl.getBoundingClientRect().top
  cancelAnimationFrame(moveRaf)
  moveRaf = requestAnimationFrame(() => applyMagnify(y))
}

function onMouseLeave() {
  cancelAnimationFrame(moveRaf)
  applyMagnify(null)
}

function onMarkerFocus(marker: ConversationMinimapMarker, event: FocusEvent) {
  const btn = event.currentTarget as HTMLElement | null
  hovered.value = { marker, top: Math.max(0, (btn?.offsetTop ?? 0) - 36) }
}

function onMarkerBlur() {
  hovered.value = null
}

function roleLabel(role: ConversationMinimapMarker['role']): string {
  return role === 'user'
    ? t('workspace.minimapUserMessage')
    : t('workspace.minimapAssistantMessage')
}

function detachTargetListeners() {
  const el = props.target
  if (el) el.removeEventListener('scroll', scheduleScroll)
  contentObserver?.disconnect()
  contentObserver = null
}

function attachTargetListeners() {
  const el = props.target
  if (!el) return
  el.addEventListener('scroll', scheduleScroll, { passive: true })
  // Streamed content can change layout between marker identity changes.
  const content = el.firstElementChild
  if (content && typeof ResizeObserver !== 'undefined') {
    contentObserver = new ResizeObserver(scheduleResize)
    contentObserver.observe(content)
  }
}

function scheduleScroll() {
  cancelAnimationFrame(scrollRaf)
  scrollRaf = requestAnimationFrame(() => {
    updateActive()
    updateOverflow()
  })
}

function scheduleResize() {
  cancelAnimationFrame(resizeRaf)
  resizeRaf = requestAnimationFrame(() => {
    // The rail's gap is marker-count dependent, so dash centers move without
    // the marker set changing.
    syncLayout()
  })
}

watch(
  markerIdentity,
  () => {
    syncLayout()
  },
  { immediate: true, flush: 'post' }
)

watch(
  () => props.target,
  () => {
    detachTargetListeners()
    attachTargetListeners()
    syncLayout()
  },
  { flush: 'post' }
)

watch(visible, (isVisible) => {
  if (!isVisible) return
  // Returning from hidden remounts the rail, so re-measure its dash centers.
  requestAnimationFrame(measureMagnifyCenters)
})

watch(
  rail,
  (railEl) => {
    railObserver?.disconnect()
    railObserver = null
    if (!railEl || typeof ResizeObserver === 'undefined') return
    railObserver = new ResizeObserver(() => {
      cancelAnimationFrame(railResizeRaf)
      railResizeRaf = requestAnimationFrame(measureMagnifyCenters)
    })
    railObserver.observe(railEl)
  },
  { flush: 'post' }
)

onBeforeUnmount(() => {
  cancelAnimationFrame(moveRaf)
  cancelAnimationFrame(scrollRaf)
  cancelAnimationFrame(resizeRaf)
  cancelAnimationFrame(railResizeRaf)
  detachTargetListeners()
  window.removeEventListener('resize', scheduleResize)
  railObserver?.disconnect()
  railObserver = null
})

attachTargetListeners()
window.addEventListener('resize', scheduleResize)
</script>

<template>
  <nav
    v-if="visible"
    ref="rail"
    class="minimap-rail"
    :aria-label="$t('workspace.minimapLabel')"
    data-testid="minimap-rail"
    :style="{ '--minimap-marker-count': markers.length }"
    @mousemove="onMouseMove"
    @mouseleave="onMouseLeave"
  >
    <button
      v-for="marker in markers"
      :key="marker.id"
      :ref="(node) => setMarkerEl(marker.id, node)"
      type="button"
      class="minimap-marker"
      :class="[marker.role, { active: marker.id === activeId }]"
      :aria-label="roleLabel(marker.role)"
      :aria-current="marker.id === activeId ? 'true' : undefined"
      @focus="onMarkerFocus(marker, $event)"
      @blur="onMarkerBlur"
      @click="jumpTo(marker.id)"
    />
    <div
      v-if="hovered && hovered.marker.preview"
      class="minimap-popover"
      role="tooltip"
      :style="{ top: `${hovered.top}px` }"
    >
      <div class="minimap-popover-role">{{ roleLabel(hovered.marker.role) }}</div>
      <div class="minimap-popover-text">{{ hovered.marker.preview }}</div>
    </div>
  </nav>
</template>

<style scoped>
/* Conversation minimap: packed stack of dashes on the transcript's left edge,
 * centered inside the span between the window top and the composer. Dense
 * stacks reduce their gap and marker pitch instead of escaping that span.
 * Dashes grow horizontally with a Dock-style falloff driven by --magnify (set
 * from JS), so magnification never reflows the stack. */
.minimap-rail {
  position: absolute;
  left: 8px;
  top: 12px;
  bottom: 16px;
  z-index: 6;
  display: flex;
  width: 26px;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: clamp(0px, calc(4px - var(--minimap-marker-count) * 0.05px), 2px);
}

.minimap-marker {
  display: flex;
  align-items: center;
  flex: 0 1 auto;
  width: 100%;
  height: 8px;
  min-height: 0;
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
  outline: none;
}

.minimap-marker::before {
  content: '';
  height: min(2px, 100%);
  width: calc(var(--dash-w) * var(--magnify, 1));
  border-radius: 999px;
  background: color-mix(in oklab, var(--text-primary) 14%, transparent);
  transition:
    width 90ms var(--ease-out),
    background var(--motion-fast) var(--ease-out);
}

.minimap-marker:focus-visible::before {
  background: var(--text-secondary);
}

.minimap-marker.user {
  --dash-w: 13px;
}

.minimap-marker.assistant {
  --dash-w: 8px;
}

.minimap-marker.active::before {
  background: var(--text-primary);
}

.minimap-popover {
  position: absolute;
  left: 34px;
  z-index: 7;
  width: 248px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--border-default);
  background: var(--bg-surface-raised);
  box-shadow: var(--shadow-popover);
  pointer-events: none;
}

.minimap-popover-role {
  margin-bottom: 4px;
  font-size: 10.5px;
  font-weight: 500;
  color: var(--text-tertiary);
}

.minimap-popover-text {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 5;
  font-size: 12px;
  line-height: 1.55;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

@media (prefers-reduced-motion: reduce) {
  .minimap-marker::before {
    transition: none;
  }
}
</style>

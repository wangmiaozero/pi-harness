<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  BRIEF_FLOW,
  FLOW_LIMITS,
  FLOW_TIMELINE as T,
  FLOW_TITLE,
  between,
  briefFlowTime,
  flowStage,
  irisRadius
} from './config'
import { createFlowRenderer } from './renderer'

const props = defineProps<{ ready: boolean; brief?: boolean }>()
const emit = defineEmits<{ initialized: []; finish: []; fallback: []; timeout: [] }>()
const surface = ref<HTMLDivElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const timeline = props.brief ? BRIEF_FLOW : T

let renderer: ReturnType<typeof createFlowRenderer> | undefined
let observer: ResizeObserver | undefined
let motion: MediaQueryList | undefined
let frame = 0
let timer: ReturnType<typeof setTimeout> | undefined
let ended = false
let cleaned = false
let low = false
let prolongedFrames = 0
let started: number | undefined
let lastTick = 0
let nextPaint = 0
let width = 0
let height = 0
let dpr = 1
let painted: number = T.seed
let waiting = false
let revealStarted: number | undefined
let revealDuration = timeline.end - timeline.iris

function resize(): void {
  if (!surface.value || !canvas.value || !renderer) return
  width = surface.value.clientWidth
  height = surface.value.clientHeight
  dpr = window.devicePixelRatio || 1
  renderer.resize(canvas.value.clientWidth, canvas.value.clientHeight, dpr, low)
  renderer.draw(painted)
  if (revealStarted !== undefined) applyIris(performance.now())
}

function stage(value: string): void {
  const element = surface.value
  if (element && element.dataset.flowStage !== value) element.dataset.flowStage = value
}

function applyIris(now: number): void {
  if (revealStarted === undefined) return
  const progress = between(revealStarted, revealStarted + revealDuration, now)
  const centeredHeight = props.brief ? height * 1.28 : height
  surface.value?.style.setProperty('--iris', `${irisRadius(width, centeredHeight, progress)}px`)
  if (progress === 1) end('finish')
}

function tick(now: number): void {
  frame = 0
  if (ended) return
  try {
    if (revealStarted !== undefined) {
      applyIris(now)
    } else {
      if (started === undefined) {
        started = nextPaint = now
      }
      if (!low && lastTick) {
        prolongedFrames =
          now - lastTick > 24 ? prolongedFrames + 1 : Math.max(0, prolongedFrames - 1)
        if (prolongedFrames >= 10) {
          low = true
          resize()
        }
      }
      lastTick = now
      if (dpr !== window.devicePixelRatio) resize()
      const elapsed = Math.min(timeline.iris, now - started)
      if (now >= nextPaint - 1 || elapsed === timeline.iris) {
        const checkpoint = String(Math.floor(elapsed / 100) * 100)
        if (surface.value && surface.value.dataset.flowTime !== checkpoint) {
          surface.value.dataset.flowTime = checkpoint
        }
        painted = props.brief ? briefFlowTime(elapsed) : elapsed
        renderer?.draw(painted)
        stage(flowStage(painted))
        const period = 1000 / (low ? 30 : 60)
        nextPaint = Math.max(nextPaint + period, now)
      }
      if (elapsed === timeline.iris) {
        if (props.ready) reveal(now)
        else {
          waiting = true
          stage('waiting')
          const delay = props.brief ? BRIEF_FLOW.readyTimeout : FLOW_LIMITS.readyTimeout
          timer = setTimeout(() => end('timeout'), delay)
        }
      }
    }
    if (!ended && !waiting && !frame) frame = requestAnimationFrame(tick)
  } catch {
    end('fallback')
  }
}

function reveal(now: number, duration = timeline.end - timeline.iris): void {
  waiting = false
  if (timer) clearTimeout(timer)
  revealStarted = now
  revealDuration = duration
  stage('iris')
  applyIris(now)
  if (!ended && !frame) frame = requestAnimationFrame(tick)
}

function skip(): void {
  if (ended) return
  if (!props.ready) end('fallback')
  else if (motion?.matches) end('finish')
  else if (revealStarted === undefined) reveal(performance.now(), FLOW_LIMITS.skipReveal)
  else end('finish')
}

function onKey(event: KeyboardEvent): void {
  if (event.key !== 'Escape' && event.code !== 'Space') return
  event.preventDefault()
  event.stopImmediatePropagation()
  skip()
}

function onMotion(event: MediaQueryListEvent): void {
  if (event.matches) skip()
}

function onContextLost(): void {
  end('fallback')
}

function resizeSafely(): void {
  try {
    resize()
  } catch {
    end('fallback')
  }
}

function cleanup(): void {
  if (cleaned) return
  cleaned = true
  cancelAnimationFrame(frame)
  if (timer) clearTimeout(timer)
  observer?.disconnect()
  motion?.removeEventListener('change', onMotion)
  window.removeEventListener('keydown', onKey, true)
  canvas.value?.removeEventListener('contextlost', onContextLost)
  if (renderer) renderer.destroy()
  else if (canvas.value) canvas.value.width = canvas.value.height = 0
  renderer = undefined
}

function end(outcome: 'finish' | 'fallback' | 'timeout'): void {
  if (ended) return
  ended = true
  cleanup()
  if (outcome === 'finish') emit('finish')
  else if (outcome === 'fallback') emit('fallback')
  else emit('timeout')
}

watch(
  () => props.ready,
  (ready) => {
    if (ready && waiting && !ended) reveal(performance.now())
  }
)

onMounted(() => {
  try {
    motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (motion.matches) {
      skip()
      return
    }
    const element = canvas.value!
    element.addEventListener('contextlost', onContextLost)
    renderer = createFlowRenderer(element)
    low = navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency <= 4
    resize()
    observer = new ResizeObserver(resizeSafely)
    observer.observe(surface.value!)
    if (props.brief) observer.observe(element)
    motion.addEventListener('change', onMotion)
    window.addEventListener('keydown', onKey, true)
    frame = requestAnimationFrame(tick)
    emit('initialized')
  } catch {
    end('fallback')
  }
})

onBeforeUnmount(cleanup)
</script>

<template>
  <div
    ref="surface"
    class="cinematic-flow"
    :class="{ 'cinematic-flow--brief': brief }"
    :data-testid="brief ? 'startup-animation' : 'cinematic-flow-startup'"
    data-flow-stage="seed"
    data-flow-time="0"
    :role="brief ? undefined : 'status'"
    :aria-label="brief ? undefined : FLOW_TITLE"
    @click="skip"
  >
    <canvas ref="canvas" aria-hidden="true" />
    <slot />
  </div>
</template>

<style scoped>
.cinematic-flow {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  overflow: hidden;
  background: radial-gradient(ellipse at 50% 51%, #090517, #030207 70%);
  app-region: no-drag;
}
.cinematic-flow canvas {
  display: block;
  width: 100%;
  height: 100%;
}
.cinematic-flow--brief canvas {
  position: absolute;
  inset: 4% 0 auto;
  height: 64%;
}
.cinematic-flow--brief {
  --iris-y: 36%;
}
.cinematic-flow[data-flow-stage='iris'] {
  pointer-events: none;
  mask-image: radial-gradient(
    circle at 50% var(--iris-y, 50%),
    transparent calc(var(--iris) - 1px),
    #000 var(--iris)
  );
}
</style>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

interface Star {
  x: number
  y: number
  radius: number
  speed: number
  alpha: number
  phase: number
  tint: 'blue' | 'cyan' | 'white'
}

const props = withDefaults(
  defineProps<{
    active?: boolean
    animated?: boolean
  }>(),
  { active: true, animated: true }
)

const canvas = ref<HTMLCanvasElement | null>(null)
const stars: Star[] = []
let context: CanvasRenderingContext2D | null = null
let resizeObserver: ResizeObserver | null = null
let motionQuery: MediaQueryList | null = null
let animationFrame: number | null = null
let previousTime = 0
let width = 0
let height = 0
let pixelRatio = 1

function pseudoRandom(seed: number): number {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453
  return value - Math.floor(value)
}

function rebuildStars(): void {
  stars.length = 0
  const count = Math.max(52, Math.min(112, Math.round((width * height) / 15_500)))
  for (let index = 0; index < count; index += 1) {
    const layer = index % 3
    stars.push({
      x: pseudoRandom(index + 1) * width,
      y: pseudoRandom(index + 101) * height,
      radius: [0.55, 0.85, 1.25][layer] + pseudoRandom(index + 201) * 0.35,
      speed: [1.3, 2.6, 4.4][layer],
      alpha: [0.28, 0.48, 0.72][layer] + pseudoRandom(index + 301) * 0.18,
      phase: pseudoRandom(index + 401) * Math.PI * 2,
      tint: layer === 2 ? 'cyan' : layer === 1 ? 'blue' : 'white'
    })
  }
}

function acquireContext(element: HTMLCanvasElement): CanvasRenderingContext2D | null {
  if (!context || context.canvas !== element) {
    // No pixel readback happens on this canvas; `willReadFrequently` would
    // only force a CPU-backed surface where one is not required.
    context = element.getContext('2d', { alpha: true })
  }
  return context
}

function resizeCanvas(): void {
  const element = canvas.value
  if (!element) return
  const rect = element.getBoundingClientRect()
  const nextWidth = Math.max(1, rect.width)
  const nextHeight = Math.max(1, rect.height)
  const nextRatio = Math.min(window.devicePixelRatio || 1, 1.5)
  const bufferWidth = Math.round(nextWidth * nextRatio)
  const bufferHeight = Math.round(nextHeight * nextRatio)
  if (
    width === nextWidth &&
    height === nextHeight &&
    pixelRatio === nextRatio &&
    element.width === bufferWidth &&
    element.height === bufferHeight
  ) {
    return
  }
  const resume = shouldAnimate()
  stop()
  width = nextWidth
  height = nextHeight
  pixelRatio = nextRatio
  element.width = bufferWidth
  element.height = bufferHeight
  context = acquireContext(element)
  rebuildStars()
  draw(performance.now(), 0)
  if (resume) syncAnimation()
}

const TINT_COLORS: Record<Star['tint'], string> = {
  cyan: 'rgb(114, 225, 255)',
  blue: 'rgb(145, 179, 255)',
  white: 'rgb(224, 239, 255)'
}

function draw(now: number, deltaSeconds: number): void {
  const element = canvas.value
  const ctx = element ? acquireContext(element) : null
  if (!element || !ctx) return

  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
  ctx.clearRect(0, 0, width, height)

  for (const star of stars) {
    if (deltaSeconds > 0) {
      star.x += star.speed * deltaSeconds
      star.y += star.speed * deltaSeconds * 0.13
      if (star.x > width + 3) star.x = -3
      if (star.y > height + 3) star.y = -3
    }
    const twinkle = 0.88 + Math.sin(now / 1800 + star.phase) * 0.12
    // Opaque tint + globalAlpha composites identically to a per-star rgba()
    // string, without re-parsing a color string for every star every frame.
    ctx.globalAlpha = star.alpha * twinkle
    ctx.fillStyle = TINT_COLORS[star.tint]
    ctx.beginPath()
    ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

function shouldAnimate(): boolean {
  return Boolean(
    props.active &&
      props.animated &&
      document.visibilityState === 'visible' &&
      !motionQuery?.matches
  )
}

function stop(): void {
  if (animationFrame !== null) cancelAnimationFrame(animationFrame)
  animationFrame = null
  previousTime = 0
}

/* Star drift (~1-4px/s) and multi-second twinkle cycles cannot visibly
 * express 60fps; 32fps renders identically while halving the raster cost. */
const MIN_FRAME_MS = 1000 / 32
let lastDrawAt = 0

function tick(now: number): void {
  if (!shouldAnimate()) {
    stop()
    draw(now, 0)
    return
  }
  if (now - lastDrawAt < MIN_FRAME_MS) {
    animationFrame = requestAnimationFrame(tick)
    return
  }
  lastDrawAt = now
  const deltaSeconds = previousTime ? Math.min((now - previousTime) / 1000, 0.05) : 0
  previousTime = now
  draw(now, deltaSeconds)
  animationFrame = requestAnimationFrame(tick)
}

function syncAnimation(): void {
  stop()
  if (shouldAnimate()) animationFrame = requestAnimationFrame(tick)
  else draw(performance.now(), 0)
}

function onVisibilityChange(): void {
  syncAnimation()
}

onMounted(() => {
  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  motionQuery.addEventListener('change', syncAnimation)
  resizeObserver = new ResizeObserver(resizeCanvas)
  if (canvas.value) resizeObserver.observe(canvas.value)
  document.addEventListener('visibilitychange', onVisibilityChange)
  resizeCanvas()
  syncAnimation()
})

watch(() => [props.active, props.animated], syncAnimation)

onBeforeUnmount(() => {
  stop()
  context = null
  resizeObserver?.disconnect()
  motionQuery?.removeEventListener('change', syncAnimation)
  document.removeEventListener('visibilitychange', onVisibilityChange)
})
</script>

<template>
  <canvas ref="canvas" class="size-full" aria-hidden="true" />
</template>

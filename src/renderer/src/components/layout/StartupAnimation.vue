<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { startupChecks, startupPhase } from '@renderer/startup'
import { useSettingsStore } from '@renderer/stores/settings'
import {
  particleOrigin,
  resolveStartupVariant,
  STARTUP_PALETTES,
  type StartupVariant
} from './startup-variants'

type Star = {
  x: number
  y: number
  fromX: number
  fromY: number
  size: number
  phase: number
  color: string
}

const canvas = ref<HTMLCanvasElement | null>(null)
const settings = useSettingsStore()
const variant = computed(() => resolveStartupVariant(settings.settings))
const palette = computed(() => STARTUP_PALETTES[variant.value])
const colorVariables = computed(() => ({
  '--startup-background': palette.value.background,
  '--startup-text': palette.value.text,
  '--startup-accent': palette.value.accent,
  '--startup-secondary': palette.value.secondary
}))
const visible = ref(true)
const leaving = ref(false)
const status = computed(() => {
  switch (startupPhase.value) {
    case 'settings':
      return '正在读取设置…'
    case 'services':
      return '正在检测运行环境与服务…'
    case 'ready':
      return '检测完成'
    default:
      return '正在启动…'
  }
})

let frameId = 0
let resizeObserver: ResizeObserver | null = null
let minimumTimer: ReturnType<typeof setTimeout> | null = null
let fallbackTimer: ReturnType<typeof setTimeout> | null = null
let exitTimer: ReturnType<typeof setTimeout> | null = null
let readyTimer: ReturnType<typeof setTimeout> | null = null
let minimumElapsed = false
let startedAt = 0
let leaveStartedAt = 0
let stars: Star[] = []
let ambient: Star[] = []
let width = 0
let height = 0
let reducedMotion = false
const isWindows = /Win/i.test(navigator.platform)
let lastFrameAt = 0

function easeOut(t: number): number {
  return 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3)
}

function buildField(): void {
  const element = canvas.value
  if (!element) return
  const bounds = element.getBoundingClientRect()
  width = bounds.width
  height = bounds.height
  const ratio = isWindows ? 1 : Math.min(window.devicePixelRatio || 1, 2)
  element.width = Math.max(1, Math.round(width * ratio))
  element.height = Math.max(1, Math.round(height * ratio))
  const context = element.getContext('2d')
  if (!context) return
  context.setTransform(ratio, 0, 0, ratio, 0, 0)

  const sample = document.createElement('canvas')
  const sampleScale = isWindows ? Math.min(1, 1000 / width, 500 / height) : 1
  sample.width = Math.max(1, Math.round(width * sampleScale))
  sample.height = Math.max(1, Math.round(height * sampleScale))
  const source = sample.getContext('2d', { willReadFrequently: true })
  if (!source) return
  const fontSize = Math.min(92, Math.max(32, width * 0.092)) * sampleScale
  source.font = `600 ${fontSize}px Inter, -apple-system, BlinkMacSystemFont, sans-serif`
  source.textAlign = 'center'
  source.textBaseline = 'middle'
  source.fillText('PI-HARNESS', sample.width / 2, sample.height * 0.46)
  const pixels = source.getImageData(0, 0, sample.width, sample.height).data
  const step = width < 700 ? 4 : 5
  const points: Array<[number, number]> = []
  for (let y = 0; y < sample.height; y += step) {
    for (let x = 0; x < sample.width; x += step) {
      if (pixels[(y * sample.width + x) * 4 + 3] > 120)
        points.push([x / sampleScale, y / sampleScale])
    }
  }
  const count = Math.min(isWindows ? 450 : 1800, points.length)
  stars = Array.from({ length: count }, (_, index) => {
    const point = points[Math.floor((index * points.length) / count)]
    const [fromX, fromY] = particleOrigin(
      variant.value,
      index,
      count,
      width,
      height,
      Math.random(),
      Math.random()
    )
    return {
      x: point[0],
      y: point[1],
      fromX,
      fromY,
      size: 0.7 + Math.random() * 1.4,
      phase: Math.random() * Math.PI * 2,
      color: palette.value.particles[index % 4]
    }
  })
  ambient = Array.from(
    { length: Math.min(isWindows ? 60 : 180, Math.round(width / 6)) },
    (_, index) => ({
      x: Math.random() * width,
      y: Math.random() * height,
      fromX: 0,
      fromY: 0,
      size: 0.4 + Math.random() * 1.1,
      phase: Math.random() * Math.PI * 2,
      color: index % 7 === 0 ? palette.value.tertiary : palette.value.secondary
    })
  )
}

function drawThemeMotif(context: CanvasRenderingContext2D, elapsed: number): void {
  const current = variant.value
  if (current === 'none') return
  const { accent, secondary, tertiary } = palette.value
  const cx = width / 2
  const cy = height * 0.46
  const radius = Math.min(width * 0.24, height * 0.3)
  context.save()
  context.lineWidth = 1.25
  context.strokeStyle = accent
  context.fillStyle = accent
  context.globalAlpha = 0.34

  switch (current as Exclude<StartupVariant, 'none'>) {
    case 'maidWhite':
      for (let line = 0; line < 3; line++) {
        context.beginPath()
        for (let x = 0; x <= width; x += 12) {
          const y = cy + (line - 1) * 38 + Math.sin(x * 0.014 + elapsed * 1.5 + line) * 28
          if (x === 0) context.moveTo(x, y)
          else context.lineTo(x, y)
        }
        context.stroke()
      }
      break
    case 'office':
      for (let x = 0; x < width; x += 38) {
        const heightScale = 22 + ((x * 17) % 83)
        context.fillRect(x, cy - heightScale, 1, heightScale * 2)
      }
      context.strokeRect(cx - radius * 1.5, cy - radius * 0.7, radius * 3, radius * 1.4)
      break
    case 'starshipCockpit':
      for (let ring = 1; ring <= 3; ring++) {
        context.beginPath()
        context.arc(cx, cy, (radius * ring) / 3, 0, Math.PI * 2)
        context.stroke()
      }
      context.beginPath()
      context.moveTo(cx, cy)
      context.lineTo(cx + Math.cos(elapsed * 1.6) * radius, cy + Math.sin(elapsed * 1.6) * radius)
      context.stroke()
      break
    case 'noirScholar':
      for (let line = 0; line < 6; line++) {
        context.beginPath()
        context.moveTo(cx - radius * 1.6, cy + line * 17 - 48)
        context.bezierCurveTo(
          cx - radius * 0.6,
          cy - radius * 0.55,
          cx + radius * 0.3,
          cy + radius * 0.65,
          cx + radius * 1.5,
          cy + line * 13 - 40
        )
        context.stroke()
      }
      break
    case 'moonlitMaid':
      context.beginPath()
      context.arc(cx, cy - 22, radius * 0.9, 0, Math.PI * 2)
      context.stroke()
      context.globalAlpha = 0.13
      context.fillStyle = tertiary
      context.beginPath()
      context.arc(cx + radius * 0.22, cy - radius * 0.2, radius * 0.72, 0, Math.PI * 2)
      context.fill()
      break
    case 'mingSnow':
      for (let flake = 0; flake < 15; flake++) {
        const x = cx + Math.sin(flake * 2.4) * radius * 1.5
        const y = cy + Math.cos(flake * 1.9 + elapsed * 0.25) * radius * 0.75
        for (let arm = 0; arm < 3; arm++) {
          const angle = (arm * Math.PI) / 3
          context.beginPath()
          context.moveTo(x - Math.cos(angle) * 12, y - Math.sin(angle) * 12)
          context.lineTo(x + Math.cos(angle) * 12, y + Math.sin(angle) * 12)
          context.stroke()
        }
      }
      break
    case 'mingMoon':
      context.strokeStyle = tertiary
      for (let ring = 0; ring < 3; ring++) {
        context.beginPath()
        context.arc(cx, cy, radius * (0.7 + ring * 0.18), Math.PI * 0.08, Math.PI * 0.92)
        context.stroke()
      }
      for (let lantern = 0; lantern < 7; lantern++) {
        const x = cx + (lantern - 3) * radius * 0.39
        const y = cy + Math.sin(lantern * 1.7 + elapsed * 0.6) * 18
        context.fillStyle = lantern % 2 ? accent : secondary
        context.fillRect(x - 3, y - 5, 6, 10)
      }
      break
  }
  context.restore()
}

function draw(now: number): void {
  if (isWindows && now - lastFrameAt < 33) {
    frameId = requestAnimationFrame(draw)
    return
  }
  lastFrameAt = now
  const element = canvas.value
  const context = element?.getContext('2d')
  if (!context || !visible.value) return
  context.clearRect(0, 0, width, height)
  const elapsed = (now - startedAt) / 1000
  const progress = reducedMotion ? 1 : easeOut(elapsed / 1.75)
  const spread = leaving.value ? Math.min(1, (now - leaveStartedAt) / 500) : 0

  drawThemeMotif(context, elapsed)

  for (const star of ambient) {
    const pulse = 0.35 + 0.25 * Math.sin(elapsed * 1.7 + star.phase)
    context.globalAlpha = pulse
    context.fillStyle = star.color
    context.beginPath()
    context.arc(
      star.x + Math.sin(elapsed * 0.35 + star.phase) * 8,
      star.y,
      star.size,
      0,
      Math.PI * 2
    )
    context.fill()
  }
  for (const star of stars) {
    const orbit = Math.sin(elapsed * 1.2 + star.phase) * 1.7
    const x = star.fromX + (star.x - star.fromX) * progress + orbit * progress
    const y = star.fromY + (star.y - star.fromY) * progress + orbit * progress
    context.globalAlpha = (0.45 + 0.5 * Math.sin(elapsed * 2 + star.phase) ** 2) * (1 - spread)
    context.fillStyle = star.color
    context.beginPath()
    context.arc(x, y, star.size, 0, Math.PI * 2)
    context.fill()
  }
  context.globalAlpha = 1
  if (!reducedMotion) frameId = requestAnimationFrame(draw)
}

function finish(): void {
  if (!minimumElapsed || leaving.value || !visible.value) return
  leaving.value = true
  leaveStartedAt = performance.now()
  exitTimer = setTimeout(
    () => {
      visible.value = false
    },
    reducedMotion ? 0 : 500
  )
}

function finishWhenReady(): void {
  if (!minimumElapsed || readyTimer) return
  readyTimer = setTimeout(finish, 450)
}

watch(startupPhase, (phase) => {
  if (phase === 'ready') finishWhenReady()
})
watch(variant, () => {
  if (canvas.value && visible.value) buildField()
})

onMounted(() => {
  reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  startedAt = performance.now()
  buildField()
  resizeObserver = new ResizeObserver(buildField)
  if (canvas.value) resizeObserver.observe(canvas.value)
  frameId = requestAnimationFrame(draw)
  minimumTimer = setTimeout(
    () => {
      minimumElapsed = true
      if (startupPhase.value === 'ready') finishWhenReady()
    },
    reducedMotion ? 350 : 1800
  )
  // A stalled optional service check must not leave the application covered.
  fallbackTimer = setTimeout(() => {
    minimumElapsed = true
    finish()
  }, 8000)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(frameId)
  resizeObserver?.disconnect()
  if (minimumTimer) clearTimeout(minimumTimer)
  if (fallbackTimer) clearTimeout(fallbackTimer)
  if (exitTimer) clearTimeout(exitTimer)
  if (readyTimer) clearTimeout(readyTimer)
})
</script>

<template>
  <div
    v-if="visible"
    class="startup-animation"
    :class="{ 'startup-animation--leaving': leaving }"
    :style="colorVariables"
    data-testid="startup-animation"
    :data-startup-variant="variant"
    role="status"
    :aria-label="status"
  >
    <canvas ref="canvas" class="startup-animation__canvas" aria-hidden="true" />
    <div class="startup-animation__vignette" aria-hidden="true" />
    <div class="startup-animation__content">
      <p class="startup-animation__eyebrow">PI-HARNESS / SYSTEM INIT</p>
      <p class="startup-animation__status"><span class="startup-animation__pulse" />{{ status }}</p>
      <div class="startup-animation__rule" aria-hidden="true"><span /></div>
      <dl class="startup-animation__checks">
        <div
          v-for="(check, id) in startupChecks"
          :key="id"
          class="startup-animation__check"
          :data-testid="`startup-check-${id}`"
        >
          <dt>
            {{
              {
                network: 'npm 软件源',
                node: 'Node.js',
                npm: 'npm',
                pi: 'Pi Agent',
                config: '配置文件'
              }[id]
            }}
          </dt>
          <dd :class="`startup-animation__result--${check.state}`">
            <span class="startup-animation__indicator" />{{ check.detail }}
          </dd>
        </div>
      </dl>
    </div>
  </div>
</template>

<style scoped>
.startup-animation {
  position: fixed;
  inset: 0;
  z-index: 2000;
  overflow: hidden;
  background: var(--startup-background);
  color: var(--startup-text);
  transition: opacity 500ms ease;
}
.startup-animation--leaving {
  opacity: 0;
  pointer-events: none;
}
.startup-animation__canvas,
.startup-animation__vignette {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.startup-animation__vignette {
  pointer-events: none;
  background: radial-gradient(ellipse at 50% 46%, transparent 18%, rgba(0, 0, 0, 0.8) 100%);
}
.startup-animation__content {
  position: absolute;
  top: 62%;
  left: 50%;
  width: min(340px, 70vw);
  transform: translateX(-50%);
  text-align: center;
}
.startup-animation__eyebrow {
  margin: 0 0 13px;
  color: color-mix(in srgb, var(--startup-text) 37%, transparent);
  font:
    10px/1.4 ui-monospace,
    SFMono-Regular,
    monospace;
  letter-spacing: 0.25em;
}
.startup-animation__status {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 9px;
  margin: 0;
  color: color-mix(in srgb, var(--startup-text) 72%, transparent);
  font-size: 12px;
  letter-spacing: 0.08em;
}
.startup-animation__pulse {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--startup-accent);
  box-shadow: 0 0 12px var(--startup-accent);
  animation: pulse 1.3s ease-in-out infinite;
}
.startup-animation__rule {
  height: 1px;
  margin-top: 23px;
  background: color-mix(in srgb, var(--startup-text) 12%, transparent);
  overflow: hidden;
}
.startup-animation__rule span {
  display: block;
  width: 35%;
  height: 100%;
  background: linear-gradient(90deg, transparent, var(--startup-accent), transparent);
  animation: scan 1.7s ease-in-out infinite;
}
.startup-animation__checks {
  margin: 14px 0 0;
  padding: 0;
}
.startup-animation__check {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 26px;
  color: color-mix(in srgb, var(--startup-text) 48%, transparent);
  font:
    11px/1.4 ui-monospace,
    SFMono-Regular,
    monospace;
  letter-spacing: 0.03em;
}
.startup-animation__check dt,
.startup-animation__check dd {
  margin: 0;
}
.startup-animation__check dd {
  display: flex;
  align-items: center;
  gap: 8px;
  color: color-mix(in srgb, var(--startup-text) 64%, transparent);
}
.startup-animation__indicator {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #68727f;
}
.startup-animation__result--healthy .startup-animation__indicator {
  background: var(--startup-accent);
  box-shadow: 0 0 8px var(--startup-accent);
}
.startup-animation__result--warning .startup-animation__indicator {
  background: #f87915;
}
.startup-animation__result--error .startup-animation__indicator {
  background: #f06565;
}
@keyframes pulse {
  50% {
    opacity: 0.25;
    transform: scale(0.65);
  }
}
@keyframes scan {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(380%);
  }
}
@media (prefers-reduced-motion: reduce) {
  .startup-animation,
  .startup-animation__pulse,
  .startup-animation__rule span {
    animation: none;
    transition: none;
  }
}
</style>

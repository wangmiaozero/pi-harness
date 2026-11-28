<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
  type Component
} from 'vue'
import {
  STARTUP_MINIMUM_VISIBLE_MS,
  startupAnimationVisible,
  startupPhase,
  startupScheme
} from '@renderer/startup'
import { BRIEF_FLOW, FLOW_LIMITS } from '@renderer/cinematic-flow-startup/config'
import { useSettingsStore } from '@renderer/stores/settings'
import {
  deepseekBootClip,
  deepseekVideoPlacement,
  usesCinematicStartup,
  usesDeepseekVideoStartup,
  type DeepseekBootClip
} from '@renderer/bigfish-startup/gate'
import { MASCOT_ENABLED } from '@shared/feature-flags'
import { petPackInstalled, themePackInstalled } from '@renderer/utils/visual-skin'
import { themeAppearance } from '@shared/constants/theme'
import StartupDiagnostics from './StartupDiagnostics.vue'
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
const mode = ref<'hold' | 'particle' | 'fish' | 'flow' | 'flow-wait'>(
  startupScheme === 'flow' ? 'flow' : MASCOT_ENABLED ? 'hold' : 'particle'
)
const flowComponent = shallowRef<Component | null>(null)
const brief = startupScheme === 'legacy'
const variant = computed(() => resolveStartupVariant(settings.settings))
const palette = computed(() => STARTUP_PALETTES[variant.value])
const colorVariables = computed(() => ({
  '--startup-background': palette.value.background,
  '--startup-text': palette.value.text,
  '--startup-accent': palette.value.accent,
  '--startup-secondary': palette.value.secondary
}))
const visible = startupAnimationVisible
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
let readyTimer: ReturnType<typeof setTimeout> | null = null
let minimumElapsed = false
let startedAt = 0
let leaveStartedAt = 0
let particleStarted = false
let startupDecided = false
let holdFallback: ReturnType<typeof setTimeout> | null = null
let flowTimer: ReturnType<typeof setTimeout> | undefined
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
  if (leaving.value || !visible.value) return
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
    case 'zhangJuzhengSnow':
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
    case 'ropeWhale':
    case 'ropeDeepseek':
      for (const [ox, oy, color] of [
        [-0.7, -0.45, accent],
        [0.75, -0.2, secondary],
        [0.1, 0.55, tertiary]
      ] as const) {
        context.fillStyle = color
        context.globalAlpha = 0.16
        context.beginPath()
        context.arc(cx + ox * radius, cy + oy * radius, radius * 0.55, 0, Math.PI * 2)
        context.fill()
      }
      break
    case 'ropePhoebe':
    case 'ropeClaude':
    case 'ropeGemini':
    case 'ropeGpt':
    case 'ropeGlm':
    case 'ropeGrok':
    case 'ropeKimi':
    case 'ropeQwen':
    case 'deepseekPoster':
    case 'deepseekDream':
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
  if (!reducedMotion && !leaving.value) frameId = requestAnimationFrame(draw)
}

function finish(): void {
  if (mode.value !== 'particle' || !minimumElapsed || leaving.value || !visible.value) return
  leaving.value = true
  leaveStartedAt = performance.now()
  cancelAnimationFrame(frameId)
  frameId = 0
  resizeObserver?.disconnect()
  resizeObserver = null
  // Drop the cover in this turn. A later fade timer does not run when software GL
  // is blocked reading the full-screen canvas back.
  visible.value = false
}

function finishWhenReady(): void {
  if (mode.value !== 'particle' || !minimumElapsed || readyTimer) return
  readyTimer = setTimeout(finish, 450)
}

function armMinimum(): void {
  if (minimumTimer || minimumElapsed) return
  minimumTimer = setTimeout(() => {
    minimumElapsed = true
    if (startupPhase.value === 'ready') finishWhenReady()
  }, STARTUP_MINIMUM_VISIBLE_MS)
}

watch(startupPhase, (phase) => {
  if (mode.value === 'particle' && phase === 'ready') finishWhenReady()
  if (mode.value === 'flow-wait' && phase === 'ready') finishFlow()
})
watch(variant, () => {
  if (canvas.value && visible.value && mode.value === 'particle') buildField()
})

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function releaseStartupLock(): void {
  document.documentElement.classList.remove('dsu-lock')
  document.documentElement.style.overflow = ''
  document.body.style.overflow = ''
}

async function beginLegacyStartup(animateDefault = true): Promise<void> {
  setCinematicCover(false)
  if (particleStarted || !visible.value) return
  particleStarted = true
  if (variant.value === 'none') {
    await beginFlow(animateDefault)
    return
  }
  mode.value = 'particle'
  // The hold screen is already the cover. Counting the minimum only after the
  // field is built adds another 5s on a cold packaged launch.
  armMinimum()
  if (minimumElapsed && startupPhase.value === 'ready') finishWhenReady()
  // A stalled optional service check must not leave the application covered.
  // Arm this before the canvas build: that build blocks the main thread on software GL.
  fallbackTimer = setTimeout(() => {
    minimumElapsed = true
    finish()
  }, 8000)
  await nextTick()
  if (!visible.value) return
  reducedMotion = prefersReducedMotion()
  startedAt = performance.now()
  buildField()
  resizeObserver = new ResizeObserver(buildField)
  if (canvas.value) resizeObserver.observe(canvas.value)
  frameId = requestAnimationFrame(draw)
}

function setCinematicCover(active: boolean): void {
  if (active) document.documentElement.dataset.cinematicStartup = 'on'
  else delete document.documentElement.dataset.cinematicStartup
}

function clearFlowTimer(): void {
  clearTimeout(flowTimer)
  flowTimer = undefined
  window.removeEventListener('keydown', skipPendingFlow, true)
}

function finishFlow(): void {
  clearFlowTimer()
  visible.value = false
  flowComponent.value = null
  setCinematicCover(false)
  delete document.documentElement.dataset.cinematicFlow
}

function fallbackFlow(timedOut = false): void {
  if (!visible.value || mode.value !== 'flow') return
  clearFlowTimer()
  if (startupPhase.value === 'ready' || timedOut) {
    finishFlow()
    return
  }
  mode.value = 'flow-wait'
  flowComponent.value = null
  flowTimer = setTimeout(finishFlow, brief ? BRIEF_FLOW.readyTimeout : FLOW_LIMITS.readyTimeout)
}

function skipPendingFlow(event: KeyboardEvent): void {
  if (event.key !== 'Escape' && event.code !== 'Space') return
  event.preventDefault()
  event.stopImmediatePropagation()
  fallbackFlow()
}

async function beginFlow(animate = true): Promise<void> {
  startupDecided = true
  mode.value = 'flow'
  if (minimumTimer) clearTimeout(minimumTimer)
  if (holdFallback) clearTimeout(holdFallback)
  setCinematicCover(true)
  if (!animate || prefersReducedMotion()) {
    fallbackFlow()
    return
  }
  window.addEventListener('keydown', skipPendingFlow, true)
  flowTimer = setTimeout(() => fallbackFlow(), FLOW_LIMITS.moduleTimeout)
  try {
    const { default: Flow } = await import('@renderer/cinematic-flow-startup/CinematicFlow.vue')
    if (visible.value && mode.value === 'flow') flowComponent.value = Flow
  } catch {
    fallbackFlow()
  }
}

async function playStartupVideo(clip: DeepseekBootClip): Promise<void> {
  mode.value = 'fish'
  const { playVideoBoot } = await import('@renderer/bigfish-startup/play')
  await playVideoBoot({ clip, isReady: () => startupPhase.value === 'ready' })
}

async function finishCinematic(): Promise<void> {
  setCinematicCover(false)
  if (!visible.value) return
  if (startupPhase.value === 'ready') {
    visible.value = false
    return
  }
  await beginLegacyStartup(false)
}

async function beginFishStartup(thenVideo: boolean, clip: DeepseekBootClip): Promise<void> {
  mode.value = 'hold'
  try {
    const { cancelVideoBoot, playBigfishStartup, primeVideoBoot } =
      await import('@renderer/bigfish-startup/play')
    if (thenVideo) primeVideoBoot(clip)
    const theme = settings.settings ? themeAppearance(settings.settings.theme) : 'light'
    await playBigfishStartup({
      theme,
      mascotStyle: settings.settings?.mascotStyle,
      onReady: () => {
        if (visible.value) mode.value = 'fish'
      }
    })
    if (thenVideo && visible.value) await playStartupVideo(clip)
    else if (thenVideo) cancelVideoBoot()
  } catch {
    const { cancelVideoBoot } = await import('@renderer/bigfish-startup/play')
    cancelVideoBoot()
    releaseStartupLock()
    await beginLegacyStartup(false)
    return
  }
  await finishCinematic()
}

async function beginVideoStartup(clip: DeepseekBootClip): Promise<void> {
  try {
    await playStartupVideo(clip)
  } catch {
    releaseStartupLock()
    await beginLegacyStartup(false)
    return
  }
  await finishCinematic()
}

function considerStartup(): void {
  if (startupScheme === 'flow' || !visible.value || !MASCOT_ENABLED || startupDecided) return
  if (settings.settings) {
    startupDecided = true
    const reducedMotion = prefersReducedMotion()
    const mediaReady = themePackInstalled(settings.settings.mascotStyle)
    const petReady = petPackInstalled(settings.settings.desktopPet?.activePackId)
    const video = mediaReady && usesDeepseekVideoStartup(settings.settings, { reducedMotion })
    const fish =
      usesCinematicStartup(settings.settings, { reducedMotion }) && (mediaReady || petReady)
    const placement = video ? deepseekVideoPlacement(Math.random()) : null
    const clip = deepseekBootClip(video ? Math.random() : 0)
    if (placement === 'only' || fish) setCinematicCover(true)
    if (placement === 'only') {
      void beginVideoStartup(clip)
    } else if (fish) {
      void beginFishStartup(placement === 'after', clip)
    } else {
      void beginLegacyStartup()
    }
    return
  }
  if (!settings.loading && settings.error) {
    startupDecided = true
    void beginLegacyStartup()
  }
}

watch(() => [settings.settings, settings.loading, settings.error] as const, considerStartup, {
  immediate: true
})

onMounted(() => {
  if (!visible.value) return
  if (startupScheme === 'flow') {
    void beginFlow()
    return
  }
  if (mode.value === 'flow' || mode.value === 'flow-wait') return
  armMinimum()
  if (!MASCOT_ENABLED) {
    void beginLegacyStartup()
    return
  }
  // Settings normally arrive immediately. A hung read must not leave the cover up.
  holdFallback = setTimeout(() => {
    if (mode.value === 'hold' && !startupDecided) {
      startupDecided = true
      void beginLegacyStartup(false)
    }
  }, 8000)
})

onBeforeUnmount(() => {
  clearFlowTimer()
  if (mode.value === 'flow' || mode.value === 'flow-wait') {
    visible.value = false
    delete document.documentElement.dataset.cinematicFlow
  }
  setCinematicCover(false)
  cancelAnimationFrame(frameId)
  resizeObserver?.disconnect()
  if (minimumTimer) clearTimeout(minimumTimer)
  if (fallbackTimer) clearTimeout(fallbackTimer)
  if (readyTimer) clearTimeout(readyTimer)
  if (holdFallback) clearTimeout(holdFallback)
})
</script>

<template>
  <component
    :is="flowComponent"
    v-if="visible && mode === 'flow' && flowComponent"
    :ready="startupPhase === 'ready'"
    :brief="brief"
    :data-startup-variant="brief ? variant : undefined"
    @initialized="clearFlowTimer"
    @finish="finishFlow"
    @fallback="fallbackFlow(false)"
    @timeout="fallbackFlow(true)"
  >
    <StartupDiagnostics v-if="brief" :status="status" layout="brief" />
  </component>
  <div
    v-else-if="visible && (mode === 'particle' || mode === 'flow-wait')"
    class="startup-animation"
    :class="{
      'startup-animation--leaving': leaving,
      'startup-animation--waiting': mode === 'flow-wait'
    }"
    :style="colorVariables"
    data-testid="startup-animation"
    :data-startup-variant="variant"
    :data-flow-wait="mode === 'flow-wait' || undefined"
    role="status"
    :aria-label="status"
  >
    <canvas
      v-if="mode === 'particle'"
      ref="canvas"
      class="startup-animation__canvas"
      aria-hidden="true"
    />
    <div v-if="mode === 'particle'" class="startup-animation__vignette" aria-hidden="true" />
    <StartupDiagnostics :status="status" :layout="mode === 'particle' ? 'themed' : 'waiting'" />
  </div>
  <div
    v-else-if="visible && mode !== 'fish'"
    class="startup-animation startup-animation--hold"
    :class="{ 'startup-animation--waiting': mode === 'flow' }"
    data-testid="startup-animation"
    data-startup-variant="pending"
    role="status"
    aria-label="正在启动…"
    @click="mode === 'flow' && fallbackFlow()"
  />
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
.startup-animation--hold {
  background: #000;
}
.startup-animation--waiting {
  z-index: 2147483647;
  background: #030207;
  color: #dad0ff;
  app-region: no-drag;
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
@media (prefers-reduced-motion: reduce) {
  .startup-animation {
    transition: none;
  }
}
</style>

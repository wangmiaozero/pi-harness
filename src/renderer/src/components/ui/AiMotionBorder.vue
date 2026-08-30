<script setup lang="ts">
import { Motion } from 'ai-motion'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    active: boolean
    borderWidth?: number
    glowWidth?: number
    borderRadius?: number
    maxPixelRatio?: number
  }>(),
  {
    borderWidth: 2.5,
    glowWidth: 42,
    borderRadius: 7,
    maxPixelRatio: 2
  }
)

const host = ref<HTMLElement | null>(null)
const fallback = ref(false)
const reducedMotion = ref(false)
let motion: Motion | null = null
let mounted = false
let pauseTimer: number | null = null
let reducedMotionQuery: MediaQueryList | null = null
let themeObserver: MutationObserver | null = null

function pixelRatio(): number {
  return Math.min(window.devicePixelRatio || 1, Math.max(0.5, props.maxPixelRatio))
}

function currentMode(): 'dark' | 'light' {
  return document.documentElement.dataset.appearance === 'light' ? 'light' : 'dark'
}

function clearPauseTimer() {
  if (pauseTimer === null) return
  window.clearTimeout(pauseTimer)
  pauseTimer = null
}

function disposeMotion() {
  clearPauseTimer()
  motion?.dispose()
  motion = null
}

function createMotion(): Motion | null {
  if (motion || !host.value || reducedMotion.value) return motion
  const rect = host.value.getBoundingClientRect()
  try {
    motion = new Motion({
      width: Math.max(1, rect.width),
      height: Math.max(1, rect.height),
      ratio: pixelRatio(),
      mode: currentMode(),
      borderWidth: props.borderWidth,
      glowWidth: props.glowWidth,
      borderRadius: props.borderRadius,
      skipGreeting: true,
      styles: {
        position: 'absolute',
        inset: '0'
      }
    })
    host.value.appendChild(motion.element)
    motion.autoResize(host.value)
    fallback.value = false
    return motion
  } catch {
    fallback.value = true
    motion = null
    return null
  }
}

function syncActive() {
  if (!mounted) return
  clearPauseTimer()
  if (!props.active || reducedMotion.value) {
    if (motion) {
      pauseTimer = window.setTimeout(() => {
        motion?.pause()
        pauseTimer = null
      }, 200)
    }
    return
  }

  const instance = createMotion()
  if (!instance || !host.value) return
  const rect = host.value.getBoundingClientRect()
  instance.start()
  instance.resize(Math.max(1, rect.width), Math.max(1, rect.height), pixelRatio())
}

function onReducedMotionChange(event: MediaQueryListEvent) {
  reducedMotion.value = event.matches
  if (event.matches) disposeMotion()
  else fallback.value = false
  syncActive()
}

watch(() => props.active, syncActive)

onMounted(() => {
  mounted = true
  reducedMotionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null
  reducedMotion.value = reducedMotionQuery?.matches ?? false
  reducedMotionQuery?.addEventListener('change', onReducedMotionChange)
  themeObserver = new MutationObserver(() => {
    if (!motion) return
    disposeMotion()
    fallback.value = false
    syncActive()
  })
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme']
  })
  syncActive()
})

onBeforeUnmount(() => {
  mounted = false
  reducedMotionQuery?.removeEventListener('change', onReducedMotionChange)
  themeObserver?.disconnect()
  disposeMotion()
})
</script>

<template>
  <div
    ref="host"
    aria-hidden="true"
    data-testid="ai-motion-border"
    class="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit] transition-opacity duration-200"
    :class="active ? 'opacity-100' : 'opacity-0'"
  >
    <div
      v-if="fallback || reducedMotion"
      class="absolute inset-0 rounded-[inherit] border border-[rgb(189,69,251)] opacity-70"
    />
  </div>
</template>

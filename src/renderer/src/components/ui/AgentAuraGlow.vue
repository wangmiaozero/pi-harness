<script setup lang="ts">
import { aura, type BurningFire, type Glow } from 'agent-aura'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    active: boolean
    kind?: 'glow' | 'burning'
    borderWidth?: number
    glowWidth?: number
    borderRadius?: number
    maxPixelRatio?: number
  }>(),
  {
    kind: 'glow',
    borderWidth: 2.5,
    glowWidth: 42,
    borderRadius: 7,
    maxPixelRatio: 2
  }
)

const host = ref<HTMLElement | null>(null)
const fallback = ref(false)
const reducedMotion = ref(false)
let glow: Glow | null = null
let burning: BurningFire | null = null
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

function disposeEffects() {
  clearPauseTimer()
  glow?.dispose()
  burning?.dispose()
  glow = null
  burning = null
}

function createGlow(): Glow | null {
  if (glow || !host.value || reducedMotion.value) return glow
  const rect = host.value.getBoundingClientRect()
  try {
    glow = aura.glow(host.value, {
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
    fallback.value = false
    return glow
  } catch {
    fallback.value = true
    glow = null
    return null
  }
}

function createBurning(): BurningFire | null {
  if (burning || !host.value || reducedMotion.value) return burning
  try {
    burning = aura.burning(host.value, {
      container: host.value,
      skipGreeting: true,
      padding: 2
    })
    fallback.value = false
    return burning
  } catch {
    fallback.value = true
    burning = null
    return null
  }
}

function syncActive() {
  if (!mounted) return
  clearPauseTimer()
  if ((props.kind === 'burning' && glow) || (props.kind !== 'burning' && burning)) {
    disposeEffects()
  }
  if (!props.active || reducedMotion.value) {
    const instance = glow ?? burning
    if (instance) {
      pauseTimer = window.setTimeout(() => {
        instance.pause()
        pauseTimer = null
      }, 200)
    }
    return
  }

  if (props.kind === 'burning') {
    createBurning()?.start()
    return
  }

  const instance = createGlow()
  if (!instance || !host.value) return
  const rect = host.value.getBoundingClientRect()
  instance.start()
  instance.resize(Math.max(1, rect.width), Math.max(1, rect.height), pixelRatio())
}

function onReducedMotionChange(event: MediaQueryListEvent) {
  reducedMotion.value = event.matches
  if (event.matches) disposeEffects()
  else fallback.value = false
  syncActive()
}

watch(() => [props.active, props.kind], syncActive)

onMounted(() => {
  mounted = true
  reducedMotionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null
  reducedMotion.value = reducedMotionQuery?.matches ?? false
  reducedMotionQuery?.addEventListener('change', onReducedMotionChange)
  themeObserver = new MutationObserver(() => {
    if (!glow && !burning) return
    disposeEffects()
    fallback.value = false
    syncActive()
  })
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'data-appearance']
  })
  syncActive()
})

onBeforeUnmount(() => {
  mounted = false
  reducedMotionQuery?.removeEventListener('change', onReducedMotionChange)
  themeObserver?.disconnect()
  disposeEffects()
})
</script>

<template>
  <div
    ref="host"
    aria-hidden="true"
    data-testid="agent-aura-glow"
    class="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit] transition-opacity duration-200"
    :class="active ? 'opacity-100' : 'opacity-0'"
    :data-aura-kind="kind"
  >
    <div
      v-if="fallback || reducedMotion"
      class="absolute inset-0 rounded-[inherit] border border-[rgb(189,69,251)] opacity-70"
    />
  </div>
</template>

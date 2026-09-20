<script setup lang="ts">
import { aura, type FireBorder } from 'agent-aura'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{
  active: boolean
  target: HTMLElement | null
}>()

const host = ref<HTMLElement | null>(null)
const fallback = ref(false)
const reducedMotion = ref(false)
let fire: FireBorder | null = null
let mounted = false
let reducedMotionQuery: MediaQueryList | null = null

function disposeFire() {
  fire?.dispose()
  fire = null
}

function createFire(): FireBorder | null {
  if (fire || !props.target || reducedMotion.value) return fire
  try {
    fire = aura.fire(props.target, {
      skipGreeting: true,
      padding: 8,
      zIndex: 20
    })
    fallback.value = false
    return fire
  } catch {
    fallback.value = true
    fire = null
    return null
  }
}

function syncActive() {
  if (!mounted) return
  if (!props.active || reducedMotion.value || !props.target) {
    disposeFire()
    return
  }
  createFire()?.start()
}

function onReducedMotionChange(event: MediaQueryListEvent) {
  reducedMotion.value = event.matches
  if (event.matches) disposeFire()
  else fallback.value = false
  syncActive()
}

watch(() => [props.active, props.target], syncActive)

onMounted(() => {
  mounted = true
  reducedMotionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null
  reducedMotion.value = reducedMotionQuery?.matches ?? false
  reducedMotionQuery?.addEventListener('change', onReducedMotionChange)
  syncActive()
})

onBeforeUnmount(() => {
  mounted = false
  reducedMotionQuery?.removeEventListener('change', onReducedMotionChange)
  disposeFire()
})
</script>

<template>
  <div
    ref="host"
    aria-hidden="true"
    data-testid="agent-aura-fire-border"
    class="pointer-events-none absolute -inset-10 overflow-visible z-20"
  >
    <div
      v-if="fallback || reducedMotion"
      class="absolute inset-0 rounded-[inherit] border border-[rgb(255,123,34)] opacity-70"
    />
  </div>
</template>

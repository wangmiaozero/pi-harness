<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { resolvePetAnimation } from '@shared/pet/animations'
import type { PetManifest, PetState } from '@shared/pet/types'

const props = withDefaults(
  defineProps<{
    manifest: PetManifest
    state: PetState
    animated?: boolean
    variant?: 'compact' | 'background' | 'preview'
  }>(),
  { animated: true, variant: 'compact' }
)

const emit = defineEmits<{ resourceError: [theme: string] }>()
const frame = ref(0)
const failed = ref(false)
let animationFrame: number | null = null
let startedAt = 0

const resolved = computed(() => resolvePetAnimation(props.manifest, props.state))
const animationState = computed(() => resolved.value?.state ?? 'idle')
const animation = computed(() => resolved.value?.animation ?? null)
const spriteStyle = computed(() => {
  const current = animation.value
  if (!current) return {}
  const column = Math.min(frame.value, props.manifest.columns - 1)
  return {
    width: `${props.manifest.columns * 100}%`,
    height: `${props.manifest.rows * 100}%`,
    transform: `translate3d(${-column * (100 / props.manifest.columns)}%, ${-current.row * (100 / props.manifest.rows)}%, 0)`
  }
})
const viewportStyle = computed(() => ({
  aspectRatio: `${props.manifest.frameWidth} / ${props.manifest.frameHeight}`,
  width: props.variant === 'background' ? 'auto' : '100%',
  '--pet-accent': props.manifest.accent
}))

function stopAnimation(): void {
  if (animationFrame !== null) cancelAnimationFrame(animationFrame)
  animationFrame = null
}

function startAnimation(): void {
  stopAnimation()
  frame.value = 0
  startedAt = performance.now()
  const current = animation.value
  if (!props.animated || !current || current.frames <= 1) return
  const tick = (now: number) => {
    const elapsedFrames = Math.floor(((now - startedAt) * current.fps) / 1000)
    frame.value = current.loop
      ? elapsedFrames % current.frames
      : Math.min(current.frames - 1, elapsedFrames)
    if (current.loop || frame.value < current.frames - 1) {
      animationFrame = requestAnimationFrame(tick)
    } else {
      animationFrame = null
    }
  }
  animationFrame = requestAnimationFrame(tick)
}

function handleResourceError(): void {
  failed.value = true
  stopAnimation()
  console.warn(`[pet] failed to load theme resource: ${props.manifest.id}`)
  emit('resourceError', props.manifest.id)
}

watch(
  () => [props.manifest.id, props.manifest.sprite, props.state, props.animated],
  () => {
    failed.value = false
    startAnimation()
  }
)
onMounted(startAnimation)
onBeforeUnmount(stopAnimation)
</script>

<template>
  <div
    class="pet-renderer"
    :class="[`pet-renderer--${variant}`, `pet-state--${state}`, { 'pet-motion-off': !animated }]"
    :style="viewportStyle"
    :data-pet-state="state"
    :data-animation-state="animationState"
    :data-theme="manifest.id"
  >
    <div class="pet-motion size-full">
      <div class="pet-viewport size-full overflow-hidden">
        <img
          v-if="!failed && animation"
          :src="manifest.sprite"
          alt=""
          class="pet-sprite max-w-none select-none"
          :style="spriteStyle"
          draggable="false"
          @error="handleResourceError"
        />
        <div v-else class="pet-fallback flex size-full items-center justify-center">π</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pet-renderer {
  position: relative;
  width: 100%;
  transform-origin: 50% 100%;
}

.pet-motion,
.pet-viewport {
  transform-origin: 50% 100%;
}

.pet-sprite {
  display: block;
  object-fit: fill;
  transform-origin: 0 0;
  will-change: transform;
  filter: drop-shadow(0 5px 12px rgb(0 0 0 / 0.28));
}

.pet-fallback {
  color: var(--pet-accent);
  font: 700 28px/1 var(--font-mono);
  opacity: 0.5;
}

.pet-state--idle .pet-motion {
  animation: pet-breathe 5s ease-in-out infinite;
}
.pet-state--thinking .pet-motion {
  animation: pet-thinking 1.8s ease-in-out infinite;
}
.pet-state--running .pet-motion {
  animation: pet-running 0.65s ease-in-out infinite;
}
.pet-state--coding .pet-motion {
  animation: pet-coding 0.4s steps(2, end) infinite;
}
.pet-state--tool-calling .pet-motion {
  animation: pet-tool 0.8s ease-in-out infinite;
}
.pet-state--waiting .pet-motion {
  animation: pet-waiting 2.4s ease-in-out infinite;
}
.pet-state--review .pet-motion {
  animation: pet-review 2s ease-in-out infinite;
}
.pet-state--success .pet-motion {
  animation: pet-success 0.55s ease-out both;
}
.pet-state--failed .pet-motion {
  animation: pet-failed 1.8s ease-in-out infinite;
  filter: saturate(0.65);
}
.pet-state--warning .pet-motion {
  animation: pet-warning 0.45s ease-in-out infinite;
}
.pet-state--waving .pet-motion {
  animation: pet-wave 0.7s ease-in-out infinite;
}
.pet-state--jumping .pet-motion {
  animation: pet-jump 0.65s cubic-bezier(0.2, 0.8, 0.3, 1) infinite;
}
.pet-state--sleeping .pet-motion {
  animation: pet-sleep 4s ease-in-out infinite;
  filter: saturate(0.72) brightness(0.88);
}

.pet-renderer--background .pet-sprite {
  filter: saturate(0.78) contrast(0.92);
}

@keyframes pet-breathe {
  0%,
  100% {
    transform: translateY(0) scaleY(1);
  }
  50% {
    transform: translateY(-2px) scaleY(1.006);
  }
}
@keyframes pet-thinking {
  0%,
  100% {
    transform: rotate(-0.6deg) translateY(0);
  }
  50% {
    transform: rotate(0.8deg) translateY(-3px);
  }
}
@keyframes pet-running {
  0%,
  100% {
    transform: translateY(0) rotate(-0.7deg);
  }
  50% {
    transform: translateY(-4px) rotate(0.7deg);
  }
}
@keyframes pet-coding {
  0%,
  100% {
    transform: translateX(-1px) translateY(0);
  }
  50% {
    transform: translateX(1px) translateY(-2px);
  }
}
@keyframes pet-tool {
  0%,
  100% {
    transform: scale(1);
    filter: drop-shadow(0 0 0 transparent);
  }
  50% {
    transform: scale(1.012);
    filter: drop-shadow(0 0 7px var(--pet-accent));
  }
}
@keyframes pet-waiting {
  0%,
  100% {
    transform: rotate(-1deg);
  }
  50% {
    transform: rotate(1deg) translateY(-1px);
  }
}
@keyframes pet-review {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-2px) rotate(0.5deg);
  }
}
@keyframes pet-success {
  0% {
    transform: scale(0.94);
    filter: brightness(1);
  }
  65% {
    transform: scale(1.035);
    filter: brightness(1.2);
  }
  100% {
    transform: scale(1);
    filter: brightness(1);
  }
}
@keyframes pet-failed {
  0%,
  100% {
    transform: translateY(2px) rotate(-0.5deg);
  }
  50% {
    transform: translateY(4px) rotate(0.5deg);
  }
}
@keyframes pet-warning {
  0%,
  100% {
    transform: translateX(-2px);
  }
  50% {
    transform: translateX(2px);
  }
}
@keyframes pet-wave {
  0%,
  100% {
    transform: rotate(-1.8deg) translateY(0);
  }
  50% {
    transform: rotate(1.8deg) translateY(-3px);
  }
}
@keyframes pet-jump {
  0%,
  100% {
    transform: translateY(0) scaleY(1);
  }
  45% {
    transform: translateY(-10px) scaleY(1.015);
  }
}
@keyframes pet-sleep {
  0%,
  100% {
    transform: translateY(3px) scaleY(0.995);
    opacity: 0.9;
  }
  50% {
    transform: translateY(4px) scaleY(1.005);
    opacity: 0.84;
  }
}

.pet-motion-off .pet-motion {
  animation: none !important;
}

@media (prefers-reduced-motion: reduce) {
  .pet-motion {
    animation: none !important;
  }
}
</style>

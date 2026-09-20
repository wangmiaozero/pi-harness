<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import ThinkingFlame from './ThinkingFlame.vue'
import { thinkingEffectPalette } from './thinking-effect'
import {
  composerThinkingLevels,
  thinkingEffectState,
  thinkingIndex,
  thinkingLevelAt
} from './thinking-levels'
import { isGptAtLeast } from '@shared/models/gpt-version'

const model = defineModel<string>({ required: true })
const props = withDefaults(
  defineProps<{
    levels?: string[]
    modelId?: string
  }>(),
  { levels: () => composerThinkingLevels(), modelId: '' }
)

const track = ref<HTMLElement | null>(null)
const levels = computed(() => (props.levels.length ? props.levels : composerThinkingLevels()))
const index = computed(() => thinkingIndex(model.value, levels.value))
const last = computed(() => Math.max(levels.value.length - 1, 0))
const effect = computed(() => thinkingEffectState(model.value, levels.value))
const isMax = computed(() => effect.value.max)
const isUltra = computed(() => model.value === 'ultra')
const decreeKey = computed(() =>
  isUltra.value && isGptAtLeast(props.modelId, 5, 6)
    ? 'workspace.thinkingDivineAudience'
    : 'workspace.thinkingForbiddenPower'
)
const fraction = computed(() => (last.value === 0 ? 0 : index.value / last.value))
const blast = ref(makeBlast(levels.value.length))
const sparks = ref(makeSparks(isUltra.value ? 15 : 9))
const forbiddenAura = computed(() => {
  const palette = thinkingEffectPalette()
  const rgb = (color: [number, number, number]) =>
    `${Math.round(color[0] * 255)} ${Math.round(color[1] * 255)} ${Math.round(color[2] * 255)}`
  return {
    '--forbid-deep': rgb(palette.deep),
    '--forbid-mid': rgb(palette.mid),
    '--forbid-hot': rgb(palette.hot)
  }
})

watch([isMax, isUltra], ([max]) => {
  if (!max) return
  blast.value = makeBlast(levels.value.length)
  sparks.value = makeSparks(isUltra.value ? 15 : 9)
})

function makeBlast(count: number) {
  return Array.from({ length: count }, () => ({
    x: -(70 + Math.random() * 130),
    y: (Math.random() - 0.5) * 70,
    rotate: (Math.random() - 0.5) * 720,
    delay: Math.random() * 0.3
  }))
}

function makeSparks(count: number) {
  return Array.from({ length: count }, () => ({
    x: 8 + Math.random() * 84,
    y: -2 + Math.random() * 20,
    size: 1.2 + Math.random() * 2.4,
    delay: Math.random() * 1.6
  }))
}

function assign(next: string) {
  if (next === model.value) return
  model.value = next
}

function setFromClientX(clientX: number) {
  const el = track.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const inset = 10.5
  const x = Math.min(Math.max(clientX - rect.left, inset), rect.width - inset)
  const t = rect.width <= inset * 2 ? 0 : (x - inset) / (rect.width - inset * 2)
  assign(thinkingLevelAt(Math.round(t * last.value), levels.value))
}

function onPointerDown(event: PointerEvent) {
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  setFromClientX(event.clientX)
}

function onPointerMove(event: PointerEvent) {
  if (!event.buttons) return
  setFromClientX(event.clientX)
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
    event.preventDefault()
    assign(thinkingLevelAt(index.value - 1, levels.value))
  }
  if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
    event.preventDefault()
    assign(thinkingLevelAt(index.value + 1, levels.value))
  }
  if (event.key === 'Home') {
    event.preventDefault()
    assign(thinkingLevelAt(0, levels.value))
  }
  if (event.key === 'End') {
    event.preventDefault()
    assign(thinkingLevelAt(last.value, levels.value))
  }
}
</script>

<template>
  <div class="flex w-full flex-col" :style="forbiddenAura">
    <div class="thinking-slider-stage" :class="isUltra ? 'thinking-slider-stage--ultra' : ''">
    <div
      ref="track"
      data-testid="composer-thinking-slider"
      role="slider"
      tabindex="0"
      class="thinking-slider relative h-[27px] w-full cursor-pointer overflow-hidden rounded-[8px] bg-[var(--bg-hover)] outline-none focus-visible:shadow-[var(--focus-ring)]"
      :class="isUltra ? 'thinking-slider--ultra' : ''"
      :aria-label="$t('workspace.thinkingIntensity')"
      :title="isUltra ? $t('workspace.thinkingUltraHint') : $t('workspace.thinkingIntensity')"
      :aria-valuemin="0"
      :aria-valuemax="last"
      :aria-valuenow="index"
      :aria-valuetext="isMax ? $t(decreeKey) : model"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @keydown="onKeydown"
    >
      <div
        class="absolute inset-y-0 left-0 rounded-[8px] bg-[color-mix(in_srgb,var(--text-tertiary)_22%,transparent)] transition-[width] duration-150 ease-out"
        :style="{ width: `calc(${fraction} * (100% - 21px) + 21px)` }"
      />
      <div class="absolute inset-x-[9px] top-[7px] flex h-[13px] items-center justify-between">
        <span
          v-for="(level, i) in levels"
          :key="level"
          aria-hidden="true"
          class="thinking-slider__tick h-full w-[3px] rounded-[2px] bg-[var(--text-tertiary)]"
          :class="isMax ? 'thinking-slider__tick--blast' : i > index ? 'opacity-30' : 'opacity-100'"
          :style="
            isMax
              ? {
                  '--blast-x': `${blast[i]?.x ?? 0}px`,
                  '--blast-y': `${blast[i]?.y ?? 0}px`,
                  '--blast-rotate': `${blast[i]?.rotate ?? 0}deg`,
                  '--blast-delay': `${blast[i]?.delay ?? 0}s`
                }
              : undefined
          "
        />
      </div>
      <ThinkingFlame
        v-if="effect.ignited"
        :power="effect.power"
        :max="effect.max"
        :ultra="isUltra"
      />
      <div
        class="absolute top-0 h-[27px] w-[21px] rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] shadow-[var(--shadow-sm)]"
        :style="{ left: `calc(${fraction} * (100% - 21px))` }"
      />
    </div>
    </div>
    <p
      v-if="isMax"
      data-testid="composer-thinking-forbidden"
      role="status"
      class="thinking-forbidden"
    >
      <span class="thinking-forbidden__rays" aria-hidden="true" />
      <span class="thinking-forbidden__halo" aria-hidden="true" />
      <span class="thinking-forbidden__text">{{ $t(decreeKey) }}</span>
      <span
        v-for="(spark, i) in sparks"
        :key="i"
        class="thinking-forbidden__spark"
        aria-hidden="true"
        :style="{
          left: `${spark.x}%`,
          top: `${spark.y}px`,
          width: `${spark.size}px`,
          height: `${spark.size}px`,
          animationDelay: `${spark.delay}s`
        }"
      />
    </p>
  </div>
</template>

<style scoped>
.thinking-slider-stage {
  position: relative;
  overflow: visible;
  padding: 0;
}

.thinking-slider-stage--ultra {
  padding: 10px 8px 8px;
  margin: 0 -8px;
}

.thinking-slider--ultra {
  box-shadow:
    0 0 9px rgb(var(--forbid-hot) / 0.5),
    0 0 22px rgb(var(--forbid-mid) / 0.32);
  animation: thinking-ultra-pulse 1.45s ease-in-out infinite;
}

@keyframes thinking-ultra-pulse {
  0%,
  100% {
    box-shadow:
      0 0 8px rgb(var(--forbid-hot) / 0.42),
      0 0 18px rgb(var(--forbid-mid) / 0.26);
  }
  50% {
    box-shadow:
      0 0 14px rgb(var(--forbid-hot) / 0.72),
      0 0 32px rgb(var(--forbid-mid) / 0.48);
  }
}

.thinking-forbidden {
  position: relative;
  z-index: 3;
  isolation: isolate;
  overflow: visible;
  padding: 8px 4px 2px;
  text-align: center;
}

.thinking-forbidden__rays,
.thinking-forbidden__halo,
.thinking-forbidden__spark {
  pointer-events: none;
}

.thinking-forbidden__rays {
  position: absolute;
  left: 50%;
  top: 58%;
  width: 120%;
  height: 34px;
  transform: translate(-50%, -50%);
  background: conic-gradient(
    from 90deg at 50% 50%,
    transparent 0 8%,
    rgb(var(--forbid-hot) / 0.22) 10%,
    transparent 14% 33%,
    rgb(var(--forbid-mid) / 0.16) 36%,
    transparent 40% 62%,
    rgb(var(--forbid-hot) / 0.2) 65%,
    transparent 70% 88%,
    rgb(var(--forbid-hot) / 0.14) 92%,
    transparent 96% 100%
  );
  mask-image: radial-gradient(ellipse at 50% 50%, #000 8%, transparent 72%);
  animation: thinking-forbidden-rays 6.4s linear infinite;
}

.thinking-forbidden__halo {
  position: absolute;
  left: 50%;
  top: 58%;
  width: 78%;
  height: 22px;
  transform: translate(-50%, -50%);
  background: radial-gradient(
    ellipse at 50% 50%,
    rgb(var(--forbid-hot) / 0.55) 0%,
    rgb(var(--forbid-mid) / 0.22) 42%,
    transparent 74%
  );
  filter: blur(3px);
  animation: thinking-forbidden-halo 1.8s ease-in-out infinite;
}

.thinking-forbidden__rays,
.thinking-forbidden__halo {
  z-index: 0;
}

.thinking-forbidden__text {
  position: relative;
  z-index: 3;
  display: inline-block;
  font-size: 12.5px;
  font-weight: 650;
  letter-spacing: 0.14em;
  background-image: linear-gradient(
    110deg,
    rgb(var(--forbid-deep)) 0%,
    rgb(var(--forbid-hot)) 22%,
    #fff8e8 48%,
    rgb(var(--forbid-hot)) 72%,
    rgb(var(--forbid-deep)) 100%
  );
  background-size: 240% 100%;
  background-clip: text;
  -webkit-background-clip: text;
  color: transparent;
  filter: drop-shadow(0 0 5px rgb(var(--forbid-hot) / 0.85))
    drop-shadow(0 0 14px rgb(var(--forbid-mid) / 0.45));
  animation:
    thinking-forbidden-in 0.46s ease-out,
    thinking-forbidden-shimmer 2.2s linear infinite;
}

.thinking-forbidden__spark {
  position: absolute;
  z-index: 2;
  border-radius: 999px;
  background: #fff8e8;
  box-shadow:
    0 0 4px rgb(var(--forbid-hot) / 0.95),
    0 0 10px rgb(var(--forbid-mid) / 0.7);
  animation: thinking-forbidden-spark 1.6s ease-in-out infinite;
}

@keyframes thinking-forbidden-in {
  from {
    opacity: 0;
    letter-spacing: 0.34em;
    transform: translateY(4px) scale(0.92);
    filter: drop-shadow(0 0 18px rgb(var(--forbid-hot) / 1));
  }
  to {
    opacity: 1;
    letter-spacing: 0.14em;
    transform: translateY(0) scale(1);
  }
}

@keyframes thinking-forbidden-shimmer {
  to {
    background-position: 240% 0;
  }
}

@keyframes thinking-forbidden-halo {
  0%,
  100% {
    opacity: 0.55;
    transform: translate(-50%, -50%) scale(0.92);
  }
  50% {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1.08);
  }
}

@keyframes thinking-forbidden-rays {
  to {
    transform: translate(-50%, -50%) rotate(360deg);
  }
}

@keyframes thinking-forbidden-spark {
  0%,
  100% {
    opacity: 0.15;
    transform: scale(0.4);
  }
  45% {
    opacity: 1;
    transform: scale(1.35);
  }
}

@media (prefers-reduced-motion: reduce) {
  .thinking-forbidden__rays,
  .thinking-forbidden__halo,
  .thinking-forbidden__spark,
  .thinking-forbidden__text {
    animation: none;
  }

  .thinking-forbidden__text {
    background-position: 40% 0;
  }

  .thinking-slider--ultra {
    animation: none;
  }
}

.thinking-slider__tick {
  transition:
    opacity 0.3s ease-out,
    transform 0.3s ease-out;
}

.thinking-slider__tick--blast {
  animation: thinking-tick-blast 1.6s cubic-bezier(0.22, 0.5, 0.5, 1) forwards;
  animation-delay: var(--blast-delay);
}

@keyframes thinking-tick-blast {
  to {
    opacity: 0;
    transform: translate(var(--blast-x), var(--blast-y)) rotate(var(--blast-rotate));
  }
}
</style>

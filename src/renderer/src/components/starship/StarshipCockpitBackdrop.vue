<script setup lang="ts">
import deepSpaceImage from '@renderer/assets/themes/starship-cockpit/deep-space.png'
import distantPlanetImage from '@renderer/assets/themes/starship-cockpit/distant-planet.png'
import cockpitConsoleDeckImage from '@renderer/assets/themes/starship-cockpit/cockpit-console-deck.png'
import StarfieldCanvas from './StarfieldCanvas.vue'

withDefaults(
  defineProps<{
    workspace?: boolean
    animated?: boolean
  }>(),
  { workspace: false, animated: true }
)
</script>

<template>
  <div
    data-testid="starship-cockpit-backdrop"
    class="starship-cockpit-backdrop pointer-events-none absolute inset-0 z-0 overflow-hidden select-none"
    :data-intensity="workspace ? 'full' : 'soft'"
    :data-animated="animated ? 'true' : 'false'"
    aria-hidden="true"
  >
    <img
      :src="deepSpaceImage"
      alt=""
      draggable="false"
      class="starship-deep-space absolute inset-[-3%] size-[106%] max-w-none object-cover"
    />
    <div
      class="starship-nebula absolute inset-[-6%] bg-cover bg-center"
      :style="{ backgroundImage: `url(${deepSpaceImage})` }"
    />
    <div class="starship-aurora absolute inset-[-18%]" />
    <img
      :src="distantPlanetImage"
      alt=""
      draggable="false"
      class="starship-distant-planet absolute"
    />
    <StarfieldCanvas class="absolute inset-0" :active="true" :animated="animated" />
    <div class="starship-space-vignette absolute inset-0" />
    <img
      v-if="workspace"
      :src="cockpitConsoleDeckImage"
      alt=""
      draggable="false"
      class="starship-console-deck absolute max-w-none"
    />
  </div>
</template>

<style scoped>
.starship-cockpit-backdrop {
  background: #010511;
}

.starship-deep-space {
  opacity: 0.98;
  filter: saturate(0.98) brightness(0.94) contrast(1.08);
  animation: starship-space-drift 38s ease-in-out infinite alternate;
  will-change: transform;
}

.starship-nebula {
  opacity: 0.2;
  filter: blur(22px) saturate(1.22) brightness(1.08);
  mix-blend-mode: screen;
  animation: starship-nebula-drift 32s ease-in-out infinite alternate;
  will-change: transform, opacity;
}

.starship-aurora {
  background:
    radial-gradient(ellipse at 73% 10%, rgb(44 224 218 / 0.2), transparent 32%),
    linear-gradient(118deg, transparent 35%, rgb(65 221 221 / 0.12) 49%, transparent 63%);
  filter: blur(30px);
  mix-blend-mode: screen;
  opacity: 0.82;
  transform: rotate(-5deg);
  animation: starship-aurora-flow 26s ease-in-out infinite alternate;
  will-change: transform, opacity;
}

.starship-distant-planet {
  top: 5%;
  left: 23%;
  z-index: 1;
  width: clamp(110px, 13vw, 190px);
  max-width: none;
  opacity: 0.62;
  mix-blend-mode: screen;
  filter: saturate(0.76) brightness(0.75);
  animation: starship-planet-drift 52s ease-in-out infinite alternate;
  will-change: transform;
}

.starship-space-vignette {
  background:
    radial-gradient(ellipse at 39% 48%, transparent 0 18%, rgb(1 5 16 / 0.12) 46%, transparent 64%),
    linear-gradient(
      90deg,
      rgb(1 5 16 / 0.58),
      transparent 24%,
      transparent 49%,
      rgb(1 5 16 / 0.24) 68%,
      rgb(1 5 16 / 0.5)
    ),
    linear-gradient(180deg, rgb(1 5 16 / 0.18), transparent 28%, rgb(1 5 16 / 0.54));
}

.starship-console-deck {
  right: clamp(28px, 3.4vw, 66px);
  bottom: clamp(142px, 16vh, 186px);
  z-index: 2;
  width: clamp(380px, 30vw, 570px);
  opacity: 0.9;
  filter: saturate(0.84) brightness(0.9) contrast(1.12) drop-shadow(0 0 18px rgb(44 161 255 / 0.22));
}

[data-animated='true'] .starship-console-deck {
  animation: starship-console-pulse 5.6s ease-in-out infinite;
  will-change: opacity, filter;
}

[data-intensity='soft'] .starship-deep-space {
  opacity: 0.34;
  filter: saturate(0.72) brightness(0.52) contrast(1.05);
}

[data-intensity='soft'] .starship-nebula,
[data-intensity='soft'] .starship-aurora {
  opacity: 0.1;
}

[data-animated='false'] .starship-deep-space,
[data-animated='false'] .starship-nebula,
[data-animated='false'] .starship-aurora,
[data-animated='false'] .starship-distant-planet {
  animation: none;
}

@keyframes starship-console-pulse {
  0%,
  100% {
    opacity: 0.84;
    filter: saturate(0.8) brightness(0.84) contrast(1.1)
      drop-shadow(0 0 14px rgb(44 161 255 / 0.18));
  }
  50% {
    opacity: 0.96;
    filter: saturate(0.94) brightness(1) contrast(1.14) drop-shadow(0 0 22px rgb(44 161 255 / 0.28));
  }
}

@keyframes starship-space-drift {
  from {
    transform: scale(1.01) translate3d(-0.7%, -0.3%, 0);
  }
  to {
    transform: scale(1.045) translate3d(0.8%, 0.45%, 0);
  }
}

@keyframes starship-nebula-drift {
  from {
    transform: scale(1.05) translate3d(-1.4%, 0.4%, 0);
    opacity: 0.12;
  }
  to {
    transform: scale(1.1) translate3d(1.2%, -0.8%, 0);
    opacity: 0.2;
  }
}

@keyframes starship-aurora-flow {
  from {
    transform: rotate(-7deg) translate3d(-2%, 0, 0) scale(0.98);
    opacity: 0.5;
  }
  to {
    transform: rotate(-3deg) translate3d(2%, -1%, 0) scale(1.04);
    opacity: 0.76;
  }
}

@keyframes starship-planet-drift {
  from {
    transform: translate3d(-2%, -1%, 0) scale(0.98);
  }
  to {
    transform: translate3d(4%, 2%, 0) scale(1.025);
  }
}

@media (prefers-reduced-motion: reduce) {
  .starship-deep-space,
  .starship-nebula,
  .starship-aurora,
  .starship-distant-planet,
  .starship-console-deck {
    animation: none;
  }
}
</style>

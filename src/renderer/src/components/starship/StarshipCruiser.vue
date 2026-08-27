<script setup lang="ts">
import scoutShipImage from '@renderer/assets/themes/starship-cockpit/scout-ship-alpha.png'

withDefaults(defineProps<{ animated?: boolean }>(), { animated: true })
</script>

<template>
  <div
    class="starship-cruiser-layer pointer-events-none absolute inset-0 z-[3] overflow-hidden select-none"
    :data-animated="animated ? 'true' : 'false'"
    aria-hidden="true"
  >
    <div class="starship-cruiser">
      <span class="starship-cruiser__engine" />
      <img :src="scoutShipImage" alt="" draggable="false" />
    </div>
  </div>
</template>

<style scoped>
.starship-cruiser {
  position: absolute;
  top: 20%;
  left: 27%;
  width: clamp(150px, 15vw, 235px);
  opacity: 0;
  mix-blend-mode: screen;
  animation: starship-cruiser-path 22s linear infinite;
  will-change: transform, opacity;
}

.starship-cruiser img {
  position: relative;
  z-index: 1;
  display: block;
  width: 100%;
  max-width: none;
  filter: saturate(0.88) brightness(0.88) drop-shadow(0 0 11px rgb(91 178 255 / 0.3));
}

.starship-cruiser__engine {
  position: absolute;
  top: 48%;
  left: 8%;
  z-index: 2;
  width: 25%;
  height: 18%;
  border-radius: 50%;
  background: radial-gradient(
    ellipse,
    rgb(226 252 255 / 0.96),
    rgb(59 194 255 / 0.62) 30%,
    transparent 72%
  );
  filter: blur(5px);
  transform: translate(-35%, -50%);
  animation: starship-cruiser-engine 1.8s ease-in-out infinite;
  will-change: transform, opacity;
}

[data-animated='false'] .starship-cruiser,
[data-animated='false'] .starship-cruiser__engine {
  animation: none;
}

[data-animated='false'] .starship-cruiser {
  display: none;
}

@keyframes starship-cruiser-path {
  0% {
    opacity: 0;
    transform: translate3d(-60px, 58px, 0) scale(0.58) rotate(-3deg);
  }
  6% {
    opacity: 0.64;
  }
  92% {
    opacity: 0.64;
  }
  100% {
    opacity: 0;
    transform: translate3d(68vw, -116px, 0) scale(0.94) rotate(1deg);
  }
}

@keyframes starship-cruiser-engine {
  0%,
  100% {
    opacity: 0.58;
    transform: translate(-35%, -50%) scaleX(0.82);
  }
  50% {
    opacity: 1;
    transform: translate(-40%, -50%) scaleX(1.18);
  }
}

@media (prefers-reduced-motion: reduce) {
  .starship-cruiser {
    display: none;
  }

  .starship-cruiser,
  .starship-cruiser__engine {
    animation: none;
  }
}
</style>

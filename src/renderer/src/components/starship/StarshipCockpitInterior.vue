<script setup lang="ts">
import cockpitInteriorImage from '@renderer/assets/themes/starship-cockpit/cockpit-interior-foreground.png'

withDefaults(defineProps<{ animated?: boolean }>(), { animated: true })
</script>

<template>
  <div
    data-testid="starship-cockpit-interior"
    class="starship-cockpit-interior pointer-events-none absolute inset-0 z-[5] overflow-hidden select-none"
    :data-animated="animated ? 'true' : 'false'"
    aria-hidden="true"
  >
    <img :src="cockpitInteriorImage" alt="" draggable="false" />
  </div>
</template>

<style scoped>
.starship-cockpit-interior img {
  display: block;
  width: 100%;
  height: 100%;
  max-width: none;
  object-fit: fill;
  opacity: 0.86;
  filter: saturate(0.82) brightness(0.72) contrast(1.16)
    drop-shadow(0 0 18px rgb(44 161 255 / 0.2));
}

[data-animated='true'] img {
  animation: starship-interior-breathe 6.4s ease-in-out infinite;
  will-change: opacity, filter;
}

@keyframes starship-interior-breathe {
  0%,
  100% {
    opacity: 0.82;
    filter: saturate(0.78) brightness(0.68) contrast(1.14)
      drop-shadow(0 0 14px rgb(44 161 255 / 0.16));
  }

  50% {
    opacity: 0.9;
    filter: saturate(0.9) brightness(0.78) contrast(1.18)
      drop-shadow(0 0 24px rgb(44 161 255 / 0.26));
  }
}

@media (max-width: 1180px) {
  .starship-cockpit-interior img {
    opacity: 0.68;
  }
}

@media (max-width: 949px) {
  .starship-cockpit-interior {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .starship-cockpit-interior img {
    animation: none;
  }
}
</style>

<script setup lang="ts">
import { computed } from 'vue'
import type { MascotStyle } from '@shared/constants/mascot'
import { MASCOT_IMAGES } from '@renderer/utils/mascot-images'

const props = defineProps<{
  style: MascotStyle
}>()

const imageSource = computed(() => MASCOT_IMAGES[props.style])
</script>

<template>
  <div
    v-if="imageSource"
    data-testid="page-mascot-background"
    :data-style="style"
    class="pointer-events-none absolute inset-0 z-0 overflow-hidden select-none"
    aria-hidden="true"
  >
    <img
      :src="imageSource"
      alt=""
      class="mascot-background-image absolute -bottom-[10%] right-[2%] h-[96%] max-h-[760px] w-auto max-w-[42%] object-contain object-bottom"
      draggable="false"
    />
  </div>
</template>

<style scoped>
.mascot-background-image {
  opacity: 0.11;
  filter: saturate(0.78) contrast(0.92);
  -webkit-mask-image: linear-gradient(
    to right,
    transparent 0%,
    rgb(0 0 0 / 0.72) 24%,
    #000 48%,
    #000 100%
  );
  mask-image: linear-gradient(to right, transparent 0%, rgb(0 0 0 / 0.72) 24%, #000 48%, #000 100%);
}

:global(:root[data-theme='light'] .mascot-background-image) {
  opacity: 0.065;
  filter: saturate(0.68) contrast(0.86);
}

@media (max-width: 1080px) {
  .mascot-background-image {
    right: 1%;
    height: 82%;
    max-width: 38%;
    opacity: 0.075;
  }

  :global(:root[data-theme='light'] .mascot-background-image) {
    opacity: 0.05;
  }
}
</style>

<script setup lang="ts">
import { computed } from 'vue'
import type { MascotStyle } from '@shared/constants/mascot'
import { MASCOT_IMAGES } from '@renderer/utils/mascot-images'

const props = defineProps<{
  style: MascotStyle
  active?: boolean
}>()

const imageSource = computed(() => MASCOT_IMAGES[props.style])
</script>

<template>
  <div
    v-if="imageSource"
    data-testid="workspace-mascot"
    :data-style="style"
    :data-active="active ? 'true' : 'false'"
    class="pointer-events-none absolute bottom-2.5 right-2.5 z-10 h-[168px] w-[112px] select-none"
    aria-hidden="true"
  >
    <img
      :src="imageSource"
      alt=""
      class="mascot-image size-full object-contain object-bottom"
      draggable="false"
    />
  </div>
</template>

<style scoped>
.mascot-image {
  filter: drop-shadow(0 5px 12px rgb(0 0 0 / 0.28));
  transform-origin: 50% 100%;
  animation: mascot-idle 5.5s ease-in-out infinite;
}

[data-active='true'] .mascot-image {
  animation: mascot-active 1.6s ease-in-out infinite;
}

@keyframes mascot-idle {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-2px);
  }
}

@keyframes mascot-active {
  0%,
  100% {
    filter: drop-shadow(0 5px 12px rgb(0 0 0 / 0.28));
    transform: translateY(0);
  }
  50% {
    filter: drop-shadow(0 5px 14px rgb(91 145 245 / 0.42));
    transform: translateY(-2px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .mascot-image,
  [data-active='true'] .mascot-image {
    animation: none;
  }
}
</style>

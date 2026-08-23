<script setup lang="ts">
import { computed } from 'vue'
import type { MascotStyle } from '@shared/constants/mascot'
import type { PetState } from '@shared/pet/types'
import { getPetManifest } from '@renderer/pet/manifests'
import PetRenderer from '@renderer/components/pet/PetRenderer.vue'

const props = withDefaults(
  defineProps<{
    style: MascotStyle
    state?: PetState
    enabled?: boolean
    animated?: boolean
  }>(),
  { state: 'idle', enabled: true, animated: true }
)

const manifest = computed(() => getPetManifest(props.style))
</script>

<template>
  <div
    v-if="manifest && enabled"
    data-testid="page-mascot-background"
    :data-style="style"
    :data-state="state"
    class="pointer-events-none absolute inset-0 z-0 overflow-hidden select-none"
    aria-hidden="true"
  >
    <PetRenderer
      :manifest="manifest"
      :state="state"
      :animated="animated"
      variant="background"
      class="mascot-background-renderer absolute -bottom-[10%] right-[2%] h-[96%] max-h-[760px] max-w-[42%]"
    />
  </div>
</template>

<style scoped>
.mascot-background-renderer {
  width: auto;
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

:global(:root[data-theme='light'] .mascot-background-renderer) {
  opacity: 0.065;
  filter: saturate(0.68) contrast(0.86);
}

@media (max-width: 1080px) {
  .mascot-background-renderer {
    right: 1%;
    height: 82%;
    max-width: 38%;
    opacity: 0.075;
  }

  :global(:root[data-theme='light'] .mascot-background-renderer) {
    opacity: 0.05;
  }
}
</style>

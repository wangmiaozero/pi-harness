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
    context?: 'workspace' | 'page'
  }>(),
  { state: 'idle', enabled: true, animated: true, context: 'page' }
)

const manifest = computed(() => getPetManifest(props.style))
</script>

<template>
  <div
    v-if="manifest && enabled"
    data-testid="page-mascot-background"
    :data-style="style"
    :data-state="state"
    :data-context="context"
    class="pointer-events-none absolute inset-0 z-0 overflow-hidden select-none"
    :class="style === 'starshipCockpit' ? 'mascot-background--starship' : ''"
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

.mascot-background--starship .mascot-background-renderer {
  right: auto;
  bottom: -16%;
  left: clamp(220px, 18vw, 300px);
  height: 112%;
  max-height: 980px;
  max-width: min(48vw, 660px);
  opacity: 0.94;
  filter: saturate(0.98) contrast(1.04) drop-shadow(0 0 24px rgb(75 164 255 / 0.24));
  -webkit-mask-image: linear-gradient(to bottom, #000 0%, #000 91%, transparent 100%);
  mask-image: linear-gradient(to bottom, #000 0%, #000 91%, transparent 100%);
}

.mascot-background--starship {
  z-index: 4;
}

.mascot-background--starship[data-context='page'] .mascot-background-renderer {
  right: 2%;
  left: auto;
  height: 94%;
  max-width: 42%;
  opacity: 0.13;
  filter: saturate(0.78) contrast(0.98);
  -webkit-mask-image: linear-gradient(to right, transparent, rgb(0 0 0 / 0.82) 34%, #000 60%);
  mask-image: linear-gradient(to right, transparent, rgb(0 0 0 / 0.82) 34%, #000 60%);
}

.mascot-background--starship :deep(.pet-renderer--background .pet-sprite) {
  filter: none;
}

:global(:root[data-theme='light']:not([data-visual-skin='starship-cockpit']) .mascot-background-renderer) {
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

  :global(
    :root[data-theme='light']:not([data-visual-skin='starship-cockpit']) .mascot-background-renderer
  ) {
    opacity: 0.05;
  }

  .mascot-background--starship .mascot-background-renderer {
    left: 270px;
    height: 82%;
    max-width: 38%;
    opacity: 0.82;
  }

  .mascot-background--starship[data-context='page'] .mascot-background-renderer {
    right: 1%;
    left: auto;
    opacity: 0.1;
  }
}

@media (max-width: 949px) {
  .mascot-background--starship[data-context='workspace'] {
    display: none;
  }
}
</style>

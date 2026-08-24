<script setup lang="ts">
import { computed } from 'vue'
import type { MascotStyle } from '@shared/constants/mascot'
import type { PetState } from '@shared/pet/types'
import { getPetManifest } from '@renderer/pet/manifests'
import PetRenderer from '@renderer/components/pet/PetRenderer.vue'
import PetStatus from '@renderer/components/pet/PetStatus.vue'

const props = withDefaults(
  defineProps<{
    style: MascotStyle
    state?: PetState
    currentTool?: string | null
    active?: boolean
    enabled?: boolean
    animated?: boolean
    showStatus?: boolean
  }>(),
  {
    state: 'idle',
    currentTool: null,
    active: false,
    enabled: true,
    animated: true,
    showStatus: true
  }
)

const manifest = computed(() => getPetManifest(props.style))
</script>

<template>
  <div
    v-if="manifest && enabled"
    data-testid="workspace-mascot"
    :data-style="style"
    :data-active="active ? 'true' : 'false'"
    :data-state="state"
    class="pointer-events-none absolute bottom-2.5 right-6 z-10 flex w-[112px] select-none flex-col items-center"
    aria-hidden="true"
  >
    <PetStatus
      v-if="showStatus"
      :key="`${state}:${currentTool ?? ''}`"
      :state="state"
      :current-tool="currentTool"
      class="mb-1"
    />
    <PetRenderer :manifest="manifest" :state="state" :animated="animated" />
  </div>
</template>

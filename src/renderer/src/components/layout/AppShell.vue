<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useSettingsStore } from '@renderer/stores/settings'
import { normalizeMascotStyle } from '@shared/constants/mascot'
import MascotBackground from './MascotBackground.vue'
import { usePetStore } from '@renderer/stores/pet'
import Sidebar from './Sidebar.vue'
import TitleBar from './TitleBar.vue'
import StarshipCockpitBackdrop from '@renderer/components/starship/StarshipCockpitBackdrop.vue'
import StarshipCockpitFrame from '@renderer/components/starship/StarshipCockpitFrame.vue'
import StarshipCockpitInterior from '@renderer/components/starship/StarshipCockpitInterior.vue'
import StarshipCruiser from '@renderer/components/starship/StarshipCruiser.vue'
import StarshipEngineHud from '@renderer/components/starship/StarshipEngineHud.vue'
import PetStatus from '@renderer/components/pet/PetStatus.vue'
import { isStarshipCockpitActive } from '@renderer/utils/visual-skin'

const route = useRoute()
const settings = useSettingsStore()
const pet = usePetStore()
const isWorkspace = computed(() => route.path.startsWith('/workspace'))
const mascotStyle = computed(() => normalizeMascotStyle(settings.settings?.mascotStyle))
const starshipCockpitActive = computed(() => isStarshipCockpitActive(settings.settings))
const pageVisible = ref(document.visibilityState === 'visible')
const visualAnimationsEnabled = computed(
  () => (settings.settings?.petAnimations ?? true) && pageVisible.value
)

function syncVisibility(): void {
  pageVisible.value = document.visibilityState === 'visible'
}

onMounted(() => document.addEventListener('visibilitychange', syncVisibility))
onBeforeUnmount(() => document.removeEventListener('visibilitychange', syncVisibility))
</script>

<template>
  <div
    data-testid="app-shell"
    class="app-shell relative flex h-full flex-col overflow-hidden bg-[var(--bg-window)]"
    :data-visual-skin="starshipCockpitActive ? 'starship-cockpit' : undefined"
  >
    <TitleBar :starship-cockpit="starshipCockpitActive" />
    <div class="app-body relative z-[2] flex min-h-0 flex-1">
      <Sidebar />
      <div
        class="starship-viewport-root relative isolate min-h-0 flex-1 overflow-hidden bg-[var(--bg-workspace)]"
      >
        <StarshipCockpitBackdrop
          v-if="starshipCockpitActive"
          :workspace="isWorkspace"
          :animated="visualAnimationsEnabled"
        />
        <StarshipCockpitInterior
          v-if="starshipCockpitActive && isWorkspace"
          :animated="visualAnimationsEnabled"
        />
        <MascotBackground
          :style="mascotStyle"
          :state="pet.state"
          :enabled="Boolean(settings.settings?.mascotUnlocked && settings.settings?.petEnabled)"
          :animated="visualAnimationsEnabled"
          :context="isWorkspace ? 'workspace' : 'page'"
        />
        <PetStatus
          v-if="
            starshipCockpitActive &&
            isWorkspace &&
            Boolean(settings.settings?.petStatusText ?? true)
          "
          :key="`${pet.state}:${pet.currentTool ?? ''}`"
          class="starship-navigator-bubble"
          tail="left"
          :state="pet.state"
          :current-tool="pet.currentTool"
          aria-hidden="true"
        />
        <main
          class="relative z-10 h-full min-h-0"
          :class="isWorkspace ? 'overflow-hidden' : 'overflow-y-auto'"
        >
          <slot />
        </main>
        <StarshipCruiser
          v-if="starshipCockpitActive && isWorkspace"
          :animated="visualAnimationsEnabled"
        />
      </div>
    </div>
    <StarshipEngineHud
      v-if="starshipCockpitActive && isWorkspace"
      :state="pet.state"
      :animated="visualAnimationsEnabled"
    />
    <StarshipCockpitFrame v-if="starshipCockpitActive" />
  </div>
</template>

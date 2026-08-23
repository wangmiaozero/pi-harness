<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useSettingsStore } from '@renderer/stores/settings'
import { normalizeMascotStyle } from '@shared/constants/mascot'
import MascotBackground from './MascotBackground.vue'
import { usePetStore } from '@renderer/stores/pet'
import Sidebar from './Sidebar.vue'
import TitleBar from './TitleBar.vue'

const route = useRoute()
const settings = useSettingsStore()
const pet = usePetStore()
const isWorkspace = computed(() => route.path.startsWith('/workspace'))
const mascotStyle = computed(() => normalizeMascotStyle(settings.settings?.mascotStyle))
</script>

<template>
  <div class="flex h-full flex-col bg-[var(--bg-window)]">
    <TitleBar />
    <div class="flex min-h-0 flex-1">
      <Sidebar />
      <div class="relative isolate min-h-0 flex-1 overflow-hidden bg-[var(--bg-workspace)]">
        <MascotBackground
          :style="mascotStyle"
          :state="pet.state"
          :enabled="settings.settings?.petEnabled ?? true"
          :animated="settings.settings?.petAnimations ?? true"
        />
        <main
          class="relative z-10 h-full min-h-0"
          :class="isWorkspace ? 'overflow-hidden' : 'overflow-y-auto'"
        >
          <slot />
        </main>
      </div>
    </div>
  </div>
</template>

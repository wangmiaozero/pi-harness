<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import Sidebar from './Sidebar.vue'
import TitleBar from './TitleBar.vue'

const route = useRoute()
const isWorkspace = computed(() => route.path.startsWith('/workspace'))
</script>

<template>
  <div class="flex h-full flex-col bg-[var(--bg-window)]">
    <TitleBar />
    <div class="flex min-h-0 flex-1">
      <Sidebar />
      <main
        class="min-h-0 flex-1 bg-[var(--bg-workspace)]"
        :class="isWorkspace ? 'overflow-hidden' : 'overflow-y-auto'"
      >
        <slot />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import Sidebar from './Sidebar.vue'
import TitleBar from './TitleBar.vue'
</script>

<template>
  <div class="flex h-full flex-col bg-[var(--bg-window)]">
    <TitleBar />
    <div class="flex min-h-0 flex-1">
      <Sidebar />
      <!-- Workspace — flat, no Card chrome. Padding is set per page. -->
      <main class="min-h-0 flex-1 overflow-y-auto bg-[var(--bg-workspace)]">
        <slot />
      </main>
    </div>
  </div>
</template>

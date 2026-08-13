<script setup lang="ts">
import type { Component } from 'vue'

defineProps<{
  title: string
  description?: string
  icon?: Component
}>()
</script>

<template>
  <!-- macOS-style minimal empty state. 280-360px wide, never a giant illustration. -->
  <div class="flex flex-col items-center justify-center gap-1.5 px-6 py-8 text-center">
    <component
      :is="icon"
      v-if="icon"
      class="size-5 text-[var(--text-tertiary)]"
      :stroke-width="1.5"
    />
    <p class="mt-1 text-[12.5px] font-medium text-[var(--text-secondary)]">
      {{ title }}
    </p>
    <p
      v-if="description"
      class="max-w-[280px] text-[11.5px] leading-snug text-[var(--text-tertiary)]"
    >
      {{ description }}
    </p>
    <slot />
  </div>
</template>

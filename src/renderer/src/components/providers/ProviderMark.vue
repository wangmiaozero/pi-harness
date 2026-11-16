<script setup lang="ts">
import { computed } from 'vue'
import { providerIcon } from './provider-icons'

const props = defineProps<{ providerId: string; name: string }>()
const icon = computed(() => providerIcon(props.providerId))
const maskImage = computed(() => (icon.value ? `url("${icon.value.url}")` : undefined))
</script>

<template>
  <span
    aria-hidden="true"
    class="grid size-8 shrink-0 place-items-center rounded-[9px] border border-[var(--border-subtle)] bg-[var(--bg-hover)] text-[12px] font-semibold text-[var(--text-secondary)]"
  >
    <span
      v-if="icon?.monochrome"
      class="size-4 bg-current [mask-position:center] [mask-repeat:no-repeat] [mask-size:contain]"
      :style="{ maskImage }"
    />
    <img v-else-if="icon" :src="icon.url" alt="" class="size-4 object-contain" />
    <slot v-else>{{ Array.from(name.trim())[0]?.toUpperCase() }}</slot>
  </span>
</template>

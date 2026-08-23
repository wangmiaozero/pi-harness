<script setup lang="ts">
import { computed } from 'vue'
import { i18n } from '@renderer/i18n'
import { categorizePetTool } from '@shared/pet/tool-detector'
import type { PetState } from '@shared/pet/types'

const props = defineProps<{ state: PetState; currentTool?: string | null }>()
const label = computed(() => {
  if ((props.state === 'coding' || props.state === 'tool-calling') && props.currentTool) {
    const category = categorizePetTool(props.currentTool)
    return i18n.global.t(`pet.tool${category[0].toUpperCase()}${category.slice(1)}`)
  }
  const stateKey =
    props.state === 'tool-calling'
      ? 'ToolCalling'
      : `${props.state[0].toUpperCase()}${props.state.slice(1)}`
  return i18n.global.t(`pet.state${stateKey}`)
})
</script>

<template>
  <div class="pet-status" :data-state="state">
    <span class="pet-status-dot" aria-hidden="true" />
    <span class="truncate">{{ label }}</span>
  </div>
</template>

<style scoped>
.pet-status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-width: 0;
  color: var(--text-tertiary);
  font-size: 10.5px;
  line-height: 16px;
}
.pet-status-dot {
  width: 5px;
  height: 5px;
  flex: none;
  border-radius: 999px;
  background: var(--text-tertiary);
  box-shadow: 0 0 5px currentColor;
}
[data-state='running'] .pet-status-dot,
[data-state='thinking'] .pet-status-dot,
[data-state='coding'] .pet-status-dot,
[data-state='tool-calling'] .pet-status-dot {
  background: var(--accent);
}
[data-state='success'] .pet-status-dot,
[data-state='jumping'] .pet-status-dot {
  background: var(--success);
}
[data-state='warning'] .pet-status-dot,
[data-state='waiting'] .pet-status-dot {
  background: var(--warning);
}
[data-state='failed'] .pet-status-dot {
  background: var(--error);
}
</style>

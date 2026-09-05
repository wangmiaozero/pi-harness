<script setup lang="ts">
import { computed } from 'vue'
import { i18n } from '@renderer/i18n'
import { categorizePetTool } from '@shared/pet/tool-detector'
import type { PetState } from '@shared/pet/types'

const props = withDefaults(
  defineProps<{
    state: PetState
    currentTool?: string | null
    tail?: 'bottom' | 'left'
  }>(),
  { currentTool: null, tail: 'bottom' }
)
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
  <div data-testid="pet-status-bubble" class="pet-status" :data-state="state" :data-tail="tail">
    <span class="pet-status-dot" aria-hidden="true" />
    <span class="pet-status-label">{{ label }}</span>
  </div>
</template>

<style scoped>
.pet-status {
  --pet-status-color: var(--text-tertiary);
  --pet-status-bg: color-mix(in srgb, var(--bg-surface-raised) 94%, transparent);
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  width: max-content;
  min-width: 48px;
  max-width: 144px;
  min-height: 24px;
  padding: 3px 8px;
  border: 1px solid color-mix(in srgb, var(--pet-status-color) 34%, var(--border-default));
  border-radius: 8px;
  background: var(--pet-status-bg);
  color: var(--text-secondary);
  font-size: 10.5px;
  line-height: 15px;
  text-align: center;
  box-shadow: var(--shadow-popover);
  backdrop-filter: blur(10px);
  animation: pet-status-enter 160ms var(--ease-out) both;
}

/* Windows: skip the blur; the bubble background is near-opaque anyway. */
:global(:root[data-platform='win']) .pet-status {
  backdrop-filter: none;
  --pet-status-bg: var(--bg-surface-raised);
}
.pet-status::after {
  position: absolute;
  left: 50%;
  bottom: -4px;
  width: 7px;
  height: 7px;
  border-right: 1px solid color-mix(in srgb, var(--pet-status-color) 34%, var(--border-default));
  border-bottom: 1px solid color-mix(in srgb, var(--pet-status-color) 34%, var(--border-default));
  background: var(--pet-status-bg);
  content: '';
  transform: translateX(-50%) rotate(45deg);
}
.pet-status[data-tail='left']::after {
  top: 54%;
  bottom: auto;
  left: -4px;
  transform: translateY(-50%) rotate(135deg);
}
.pet-status-label {
  min-width: 0;
  overflow-wrap: anywhere;
}
.pet-status-dot {
  width: 5px;
  height: 5px;
  flex: none;
  border-radius: 999px;
  background: var(--pet-status-color);
  box-shadow: 0 0 5px var(--pet-status-color);
}
[data-state='running'],
[data-state='thinking'],
[data-state='coding'],
[data-state='tool-calling'] {
  --pet-status-color: var(--accent);
}
[data-state='success'],
[data-state='review'],
[data-state='jumping'] {
  --pet-status-color: var(--success);
}
[data-state='warning'],
[data-state='waiting'] {
  --pet-status-color: var(--warning);
}
[data-state='failed'] {
  --pet-status-color: var(--error);
}

@keyframes pet-status-enter {
  from {
    opacity: 0;
    transform: translateY(2px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .pet-status {
    animation: none;
  }
}
</style>

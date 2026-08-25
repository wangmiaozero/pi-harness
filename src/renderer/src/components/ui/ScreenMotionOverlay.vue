<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import AiMotionBorder from './AiMotionBorder.vue'
import { applyTheme } from '@renderer/utils/theme'
import type { ScreenMotionActivePayload } from '@shared/ipc/api-types'

const active = ref(false)
let unsubscribe: (() => void) | null = null

function readPayload(raw: unknown): ScreenMotionActivePayload {
  if (!raw || typeof raw !== 'object') return { active: false, theme: 'dark' }
  const value = raw as { active?: unknown; theme?: unknown }
  return {
    active: value.active === true,
    theme: value.theme === 'light' ? 'light' : 'dark'
  }
}

function applyPayload(raw: unknown): void {
  const next = readPayload(raw)
  applyTheme(next.theme)
  active.value = next.active
}

onMounted(() => {
  unsubscribe = window.piSwitchOverlay?.onActive(applyPayload) ?? null
})

onBeforeUnmount(() => {
  unsubscribe?.()
})
</script>

<template>
  <div
    class="pointer-events-none fixed inset-0 overflow-hidden"
    data-testid="screen-motion-overlay"
    aria-hidden="true"
  >
    <AiMotionBorder
      :active="active"
      :border-radius="0"
      :border-width="3"
      :glow-width="96"
      :max-pixel-ratio="1"
    />
  </div>
</template>

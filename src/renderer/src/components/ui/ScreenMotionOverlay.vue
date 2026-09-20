<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import AgentAuraGlow from './AgentAuraGlow.vue'
import { applyTheme } from '@renderer/utils/theme'
import type { ScreenMotionActivePayload } from '@shared/ipc/api-types'

const active = ref(false)
const kind = ref<'glow' | 'burning'>('glow')
let unsubscribe: (() => void) | null = null

function readPayload(raw: unknown): ScreenMotionActivePayload {
  if (!raw || typeof raw !== 'object') return { active: false, theme: 'dark', kind: 'glow' }
  const value = raw as { active?: unknown; theme?: unknown; kind?: unknown }
  return {
    active: value.active === true,
    theme: value.theme === 'light' ? 'light' : 'dark',
    kind: value.kind === 'burning' ? 'burning' : 'glow'
  }
}

function applyPayload(raw: unknown): void {
  const next = readPayload(raw)
  applyTheme(next.theme)
  active.value = next.active
  kind.value = next.kind ?? 'glow'
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
    <AgentAuraGlow
      :active="active"
      :kind="kind"
      :border-radius="0"
      :border-width="3"
      :glow-width="96"
      :max-pixel-ratio="1"
    />
  </div>
</template>

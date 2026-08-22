<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import AppShell from '@renderer/components/layout/AppShell.vue'
import CommandPalette from '@renderer/components/common/CommandPalette.vue'
import ConflictDialog from '@renderer/components/common/ConflictDialog.vue'
import ConfirmDialog from '@renderer/components/common/ConfirmDialog.vue'
import AiMotionBorder from '@renderer/components/ui/AiMotionBorder.vue'
import { Toaster } from 'vue-sonner'
import { useSettingsStore } from '@renderer/stores/settings'
import { useAgentStore } from '@renderer/stores/agent'
import { applyTheme, watchSystemTheme, type ThemePreference } from '@renderer/utils/theme'
import { installShortcutListener, registerShortcut } from '@renderer/composables/shortcuts'
import { shouldActivateAiMotionFrame } from '@renderer/composables/useAiMotionFrame'

const settings = useSettingsStore()
const agent = useAgentStore()
const router = useRouter()
const paletteOpen = ref(false)

const appMotionActive = computed(() =>
  shouldActivateAiMotionFrame({
    sending: agent.sending,
    runningAgentCount: agent.runningIds.length,
    streaming: agent.streaming.isStreaming,
    promptRunning: agent.state?.isPromptRunning === true
  })
)

const toasterTheme = computed(() => {
  const t = settings.settings?.theme ?? 'dark'
  if (t === 'light') return 'light'
  if (t === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'dark'
})

watch(
  () => settings.settings?.theme,
  (theme) => {
    const pref = (theme ?? 'dark') as ThemePreference
    watchSystemTheme(pref)
  },
  { immediate: true }
)

watch(
  () => settings.settings?.density,
  (density) => {
    document.documentElement.dataset.density = density ?? 'comfortable'
  },
  { immediate: true }
)

let uninstallShortcuts: (() => void) | null = null

onMounted(() => {
  applyTheme((settings.settings?.theme ?? 'dark') as ThemePreference)
  uninstallShortcuts = installShortcutListener()
  registerShortcut({
    id: 'command-palette',
    label: 'Command Palette',
    keys: ['meta+k', 'ctrl+k'],
    run: () => {
      paletteOpen.value = !paletteOpen.value
    }
  })
  registerShortcut({
    id: 'settings',
    label: 'Settings',
    keys: ['meta+,', 'ctrl+,'],
    run: () => {
      void router.push('/settings')
    }
  })
})

onBeforeUnmount(() => {
  uninstallShortcuts?.()
})
</script>

<template>
  <AppShell>
    <RouterView />
  </AppShell>
  <CommandPalette v-model:open="paletteOpen" />
  <ConflictDialog />
  <ConfirmDialog />
  <Toaster
    :theme="toasterTheme"
    position="bottom-right"
    :toast-options="{ class: 'pi-harness-toast' }"
  />
  <div
    class="pointer-events-none fixed inset-0 z-[1000] overflow-hidden rounded-[14px]"
    aria-hidden="true"
  >
    <AiMotionBorder
      :active="appMotionActive"
      :border-radius="14"
      :border-width="2.5"
      :glow-width="56"
      :max-pixel-ratio="1.5"
    />
  </div>
</template>

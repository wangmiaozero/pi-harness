<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  SHORTCUT_DEFAULTS,
  shortcutOverridesSchema,
  type ShortcutId
} from '@shared/agent-settings/schema'
import { normalizeChord } from '@renderer/composables/shortcuts'
import { useSettingsStore } from '@renderer/stores/settings'
import Button from '@renderer/components/ui/Button.vue'
import SettingsFeedback from './SettingsFeedback.vue'
import { useSettingsAction } from './useSettingsAction'
const { t } = useI18n(),
  store = useSettingsStore()
const { busy, error, message, run } = useSettingsAction()
const recording = ref<ShortcutId | null>(null)
const labels: Record<ShortcutId, string> = {
  'command-palette': 'commandPalette',
  settings: 'openSettings',
  'workspace-new-session': 'newSession',
  'workspace-close-tab': 'closeTab'
}
const entries = computed(() => Object.keys(SHORTCUT_DEFAULTS) as ShortcutId[])
const keys = (id: ShortcutId) =>
  store.settings?.shortcutOverrides?.[id] ?? [...SHORTCUT_DEFAULTS[id]]
const display = (chords: string[]) =>
  chords.length
    ? chords
        .map((c) =>
          c
            .replace('meta+', '⌘ ')
            .replace('ctrl+', 'Ctrl ')
            .replace('alt+', '⌥ ')
            .replace('shift+', '⇧ ')
            .toUpperCase()
        )
        .join(' / ')
    : t('agentSettings.unassigned')
function onKey(e: KeyboardEvent) {
  if (!recording.value) return
  e.preventDefault()
  e.stopImmediatePropagation()
  if (e.key === 'Escape') {
    recording.value = null
    return
  }
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return
  const id = recording.value
  const chord = normalizeChord(e)
  const value = { ...store.settings?.shortcutOverrides, [id]: e.key === 'Backspace' ? [] : [chord] }
  if (e.key !== 'Backspace' && !e.metaKey && !e.ctrlKey && !e.altKey) {
    error.value = t('agentSettings.shortcutInvalid')
    return
  }
  if (!shortcutOverridesSchema.safeParse(value).success) {
    error.value = t('agentSettings.shortcutConflict')
    return
  }
  recording.value = null
  void run(async () => {
    await store.patch({ shortcutOverrides: value })
  }, true)
}
watch(recording, (value) => {
  if (value) window.addEventListener('keydown', onKey, true)
  else window.removeEventListener('keydown', onKey, true)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true))
</script>
<template>
  <div class="feature-stack">
    <p class="feature-hint">{{ t('agentSettings.shortcutHint') }}</p>
    <SettingsFeedback :busy="busy" :error="error" :message="message" />
    <div class="feature-card">
      <div v-for="id in entries" :key="id" class="feature-row">
        <span>{{ t(`agentSettings.${labels[id]}`) }}</span
        ><Button
          :disabled="busy"
          :aria-label="`${t('agentSettings.record')} ${t(`agentSettings.${labels[id]}`)}`"
          @click="recording = recording === id ? null : id"
          ><kbd>{{
            recording === id ? t('agentSettings.recording') : display(keys(id))
          }}</kbd></Button
        >
      </div>
    </div>
    <div class="feature-actions">
      <Button
        :disabled="busy"
        @click="
          run(async () => {
            recording = null
            await store.patch({ shortcutOverrides: {} })
          }, true)
        "
        >{{ t('agentSettings.reset') }}</Button
      >
    </div>
    <div class="feature-card">
      <h2>{{ t('agentSettings.fixedShortcuts') }}</h2>
      <div class="feature-row">
        <span>{{ t('agentSettings.editorSave') }}</span
        ><kbd>⌘ / Ctrl + S</kbd>
      </div>
      <div class="feature-row">
        <span>{{ t('agentSettings.editorFind') }}</span
        ><kbd>⌘ / Ctrl + F</kbd>
      </div>
    </div>
  </div>
</template>

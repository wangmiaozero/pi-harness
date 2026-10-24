<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { AudioLines, Settings, Play, X } from '@lucide/vue'
import { PopoverRoot, PopoverTrigger, PopoverPortal, PopoverContent } from 'reka-ui'
import { useSessionStore } from '@renderer/stores/sessions'
import { useVoiceCall } from './useVoiceCall'
const { t } = useI18n(),
  router = useRouter(),
  sessions = useSessionStore()
const { phase, settings, detailsOpen, loadSettings, start } = useVoiceCall()
const open = ref(false),
  share = ref(false),
  loading = ref(false),
  error = ref('')
const account = computed(() =>
  settings.value?.adapter === 'codex-live'
    ? 'Codex Live'
    : settings.value?.providerKey ||
      (settings.value?.adapter === 'gemini-live' ? 'Gemini Live' : 'OpenAI Realtime')
)
async function changeOpen(value: boolean) {
  if (phase.value !== 'ended') {
    detailsOpen.value = true
    return
  }
  open.value = value
  if (!value) return
  share.value = false
  error.value = ''
  loading.value = true
  try {
    await loadSettings()
  } catch {
    error.value = t('liveVoice.settingsError')
  } finally {
    loading.value = false
  }
}
function configure() {
  open.value = false
  void router.push('/settings/voice')
}
function begin() {
  const input = {
    ...(sessions.currentId ? { sessionId: sessions.currentId } : {}),
    shareContext: share.value
  }
  open.value = false
  void start(t('agentSettings.microphoneError'), input)
}
</script>
<template>
  <PopoverRoot :open="open" @update:open="changeOpen">
    <PopoverTrigger as-child>
      <button
        type="button"
        data-testid="workspace-voice-trigger"
        class="cockpit-control-button voice-trigger"
        :class="phase !== 'ended' ? 'voice-trigger-active' : ''"
        :aria-label="t('agentSettings.voice')"
        :title="t('agentSettings.voice')"
      >
        <AudioLines class="size-4" aria-hidden="true" />
      </button>
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent
        side="top"
        align="start"
        :side-offset="14"
        :collision-padding="16"
        class="voice-preparation"
        role="dialog"
      >
        <div class="voice-heading">
          <h2 id="voice-preparation-title">{{ t('liveVoice.prepare') }}</h2>
          <button :aria-label="t('common.close')" @click="open = false">
            <X class="size-4" />
          </button>
        </div>
        <p v-if="loading" role="status" class="voice-hint">{{ t('agentSettings.loading') }}</p>
        <p v-if="error" role="alert" class="voice-error">{{ error }}</p>
        <div class="voice-account">
          <div>
            <p class="voice-hint">{{ t('liveVoice.account') }}</p>
            <strong>{{ settings?.hasCredential ? account : t('liveVoice.chooseAccount') }}</strong>
          </div>
          <button :aria-label="t('liveVoice.configure')" @click="configure">
            <Settings class="size-4" />
          </button>
        </div>
        <p v-if="!settings?.enabled || !settings.hasCredential" class="voice-hint">
          {{ t('liveVoice.setupHint') }}
        </p>
        <p v-if="sessions.current" class="voice-target">
          {{ t('liveVoice.target') }} ·
          {{ sessions.current.name || sessions.current.firstMessage || sessions.currentId }}
        </p>
        <p v-else class="voice-hint">{{ t('liveVoice.noTarget') }}</p>
        <label class="voice-checkbox"
          ><input v-model="share" type="checkbox" :disabled="!sessions.currentId" />{{
            t('liveVoice.share')
          }}</label
        >
        <p v-if="share" class="voice-hint">{{ t('liveVoice.shareHint') }}</p>
        <button
          class="voice-start"
          :disabled="loading || !settings?.enabled || !settings.hasCredential"
          @click="begin"
        >
          <Play class="size-4" />{{ t('liveVoice.start') }}
        </button>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>

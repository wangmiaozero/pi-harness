<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import {
  AudioLines,
  Mic,
  MicOff,
  PhoneOff,
  ChevronUp,
  X,
  Settings,
  ExternalLink,
  Play
} from '@lucide/vue'
import Dialog from '@renderer/components/ui/Dialog.vue'
import { useSessionStore } from '@renderer/stores/sessions'
import { useWorkspaceStore } from '@renderer/stores/workspace'
import { useVoiceCall } from './useVoiceCall'
const { t } = useI18n(),
  router = useRouter(),
  sessions = useSessionStore(),
  workspace = useWorkspaceStore()
const voice = useVoiceCall()
const {
  phase,
  muted,
  error,
  transcript,
  settings,
  preparation,
  operations,
  detailsOpen,
  userSpeaking,
  assistantSpeaking,
  stop,
  toggleMute,
  resumeAudio,
  review,
  dismiss
} = voice
const status = computed(() =>
  phase.value === 'ended'
    ? 'agentSettings.ended'
    : phase.value === 'connecting'
      ? 'agentSettings.connecting'
      : muted.value
        ? 'agentSettings.muted'
        : assistantSpeaking.value
          ? 'liveVoice.speaking'
          : userSpeaking.value
            ? 'liveVoice.hearing'
            : 'agentSettings.listening'
)
const target = computed(() => sessions.items.find((s) => s.id === preparation.value.sessionId))
function configure() {
  detailsOpen.value = false
  void router.push('/settings/voice')
}
async function viewSession() {
  const id = preparation.value.sessionId
  if (!id) return
  detailsOpen.value = false
  await router.push('/workspace')
  workspace.ensureChatTab(id, target.value?.name || target.value?.firstMessage || id)
}
onMounted(() => {
  void voice.loadSettings().catch(() => undefined)
})
onBeforeUnmount(voice.dispose)
</script>
<template>
  <div
    v-if="phase !== 'ended' || error"
    class="voice-call-bar"
    data-testid="live-voice-bar"
    role="region"
    :aria-label="t('agentSettings.voice')"
  >
    <AudioLines
      class="size-5 shrink-0 text-[var(--accent)]"
      :class="phase === 'listening' && !muted ? 'animate-pulse' : ''"
    />
    <button class="voice-call-summary" @click="detailsOpen = true">
      <strong>{{ t(error && phase === 'ended' ? 'liveVoice.callFailed' : status) }}</strong
      ><span>{{
        settings?.providerKey ||
        (settings?.adapter === 'codex-live' ? 'Codex Live' : settings?.model)
      }}</span>
    </button>
    <template v-if="phase !== 'ended'">
      <button
        :aria-label="t(muted ? 'agentSettings.unmute' : 'agentSettings.mute')"
        :title="t(muted ? 'agentSettings.unmute' : 'agentSettings.mute')"
        @click="toggleMute"
      >
        <component :is="muted ? MicOff : Mic" class="size-4" />
      </button>
      <button
        class="voice-end"
        :aria-label="t('agentSettings.endCall')"
        :title="t('agentSettings.endCall')"
        @click="stop"
      >
        <PhoneOff class="size-4" />
      </button>
    </template>
    <button
      :aria-label="t('liveVoice.details')"
      :title="t('liveVoice.details')"
      @click="detailsOpen = true"
    >
      <ChevronUp class="size-4" />
    </button>
    <button v-if="phase === 'ended'" :aria-label="t('common.close')" @click="dismiss">
      <X class="size-4" />
    </button>
  </div>
  <Dialog v-model:open="detailsOpen" :title="t('liveVoice.details')" large>
    <div class="voice-details">
      <div class="voice-heading">
        <div>
          <strong>{{ t(status) }}</strong>
          <p class="voice-hint">
            {{ settings?.adapter || 'OpenAI Realtime' }} · {{ settings?.model }} ·
            {{ settings?.voice }}
          </p>
        </div>
        <button :aria-label="t('liveVoice.configure')" @click="configure">
          <Settings class="size-4" />
        </button>
      </div>
      <div v-if="error" class="voice-error" role="alert">
        {{ error
        }}<button v-if="phase !== 'ended'" class="voice-secondary" @click="resumeAudio">
          <Play class="size-4" />{{ t('liveVoice.resumeAudio') }}
        </button>
      </div>
      <div v-if="preparation.sessionId" class="voice-target">
        <span
          >{{ t('liveVoice.target') }} ·
          {{ target?.name || target?.firstMessage || preparation.sessionId }}</span
        ><button @click="viewSession">
          <ExternalLink class="size-4" />{{ t('liveVoice.viewSession') }}
        </button>
      </div>
      <p class="voice-hint">
        {{ t(preparation.shareContext ? 'liveVoice.shared' : 'liveVoice.notShared') }}
      </p>
      <section v-if="operations.length" class="voice-section">
        <h3>{{ t('liveVoice.workRequests') }}</h3>
        <article v-for="operation in operations" :key="operation.id" class="voice-operation">
          <p class="whitespace-pre-wrap">{{ operation.instruction }}</p>
          <p class="voice-hint">{{ t(`liveVoice.workStatus.${operation.status}`) }}</p>
          <div v-if="operation.status === 'review' && phase !== 'ended'" class="flex gap-2">
            <button class="voice-start" @click="review(operation.id, true)">
              {{ t('liveVoice.sendWork') }}</button
            ><button class="voice-secondary" @click="review(operation.id, false)">
              {{ t('liveVoice.rejectWork') }}
            </button>
          </div>
        </article>
      </section>
      <section class="voice-section">
        <h3>{{ t('agentSettings.transcript') }}</h3>
        <p v-if="!transcript.length" class="voice-hint py-6 text-center">
          {{ t('agentSettings.transcriptEmpty') }}
        </p>
        <div role="log" aria-live="polite" class="voice-transcript">
          <article v-for="(item, index) in transcript" :key="index">
            <strong>{{ t(`agentSettings.${item.role}`) }}</strong>
            <p class="whitespace-pre-wrap">{{ item.text }}</p>
          </article>
        </div>
      </section>
      <div v-if="phase !== 'ended'" class="flex justify-end gap-2">
        <button class="voice-secondary" @click="toggleMute">
          <component :is="muted ? MicOff : Mic" class="size-4" />{{
            t(muted ? 'agentSettings.unmute' : 'agentSettings.mute')
          }}</button
        ><button class="voice-end voice-secondary" @click="stop">
          <PhoneOff class="size-4" />{{ t('agentSettings.endCall') }}
        </button>
      </div>
    </div>
  </Dialog>
</template>

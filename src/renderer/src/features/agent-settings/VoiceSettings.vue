<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Mic, MicOff, PhoneOff, AudioLines } from '@lucide/vue'
import type { ProviderProfile } from '@shared/types/domain'
import type { VoicePublicSettings } from '@shared/agent-settings/schema'
import { getApi } from '@renderer/composables/useApi'
import Button from '@renderer/components/ui/Button.vue'
import Switch from '@renderer/components/ui/Switch.vue'
import SettingsFeedback from './SettingsFeedback.vue'
import { useSettingsAction } from './useSettingsAction'
import { useVoiceCall } from './useVoiceCall'
const { t } = useI18n()
const { busy, error, message, run } = useSettingsAction()
const { phase, muted, error: callError, transcript, start, stop, toggleMute } = useVoiceCall()
const accounts = ref<ProviderProfile[]>([])
const availableAccounts = computed(() =>
  accounts.value.filter((p) =>
    settings.value?.adapter === 'gemini-live'
      ? p.protocol === 'google-generative-ai'
      : p.protocol.startsWith('openai')
  )
)
const voiceCall = useVoiceCall()
const settings = ref<VoicePublicSettings | null>(null),
  apiKey = ref(''),
  doubaoAppId = ref(''),
  doubaoToken = ref('')
const load = () =>
  run(async () => {
    ;[settings.value, accounts.value] = await Promise.all([
      getApi().agentSettings.voice.get(),
      getApi().providers.list()
    ])
  })
const save = () =>
  run(async () => {
    const s = settings.value!
    if (
      s.adapter === 'doubao-realtime' &&
      Boolean(doubaoAppId.value) !== Boolean(doubaoToken.value)
    )
      throw new Error(t('liveVoice.doubaoCredsIncomplete'))
    settings.value = await getApi().agentSettings.voice.save({
      enabled: s.enabled,
      ...(s.adapter ? { adapter: s.adapter } : {}),
      ...(s.providerKey ? { providerKey: s.providerKey } : {}),
      endpoint: s.endpoint,
      model: s.model,
      voice: s.voice,
      profile: s.profile,
      ...(apiKey.value
        ? { apiKey: apiKey.value }
        : s.adapter === 'doubao-realtime' && doubaoAppId.value && doubaoToken.value
          ? {
              apiKey: JSON.stringify({ appId: doubaoAppId.value, accessToken: doubaoToken.value })
            }
          : {})
    })
    apiKey.value = ''
    doubaoAppId.value = ''
    doubaoToken.value = ''
    await voiceCall.loadSettings()
  }, true)
function adapterChanged() {
  if (!settings.value) return
  settings.value.providerKey = undefined
  settings.value.model =
    settings.value.adapter === 'gemini-live'
      ? 'gemini-3.8-live'
      : settings.value.adapter === 'doubao-realtime'
        ? '1.2.1.1'
        : 'gpt-realtime'
  settings.value.voice =
    settings.value.adapter === 'gemini-live'
      ? 'Kore'
      : settings.value.adapter === 'codex-live'
        ? 'cove'
        : settings.value.adapter === 'doubao-realtime'
          ? 'zh_female_vv_jupiter_bigtts'
          : 'marin'
}
onMounted(load)
</script>
<template>
  <div class="feature-stack">
    <SettingsFeedback :busy="busy" :error="error || callError" :message="message" />
    <Button v-if="!settings && !busy" @click="load">{{ t('agentSettings.retry') }}</Button>
    <form v-if="settings" class="feature-card" @submit.prevent="save">
      <fieldset :disabled="busy || phase !== 'ended'" class="feature-stack">
        <div class="feature-row">
          <div>
            <h2 class="!mb-0">{{ t('agentSettings.enableVoice') }}</h2>
            <p class="feature-hint">{{ t('agentSettings.voiceHint') }}</p>
          </div>
          <Switch v-model="settings.enabled" :label="t('agentSettings.enableVoice')" />
        </div>
        <label class="feature-field"
          >{{ t('liveVoice.adapter')
          }}<select v-model="settings.adapter" class="feature-input" @change="adapterChanged">
            <option :value="undefined">OpenAI Realtime</option>
            <option value="openai-realtime">OpenAI Realtime · API</option>
            <option value="gemini-live">Gemini Live</option>
            <option value="codex-live">Codex Live</option>
            <option value="doubao-realtime">豆包 · 实时语音</option>
          </select></label
        >
        <label
          v-if="settings.adapter !== 'codex-live' && settings.adapter !== 'doubao-realtime'"
          class="feature-field"
          >{{ t('liveVoice.accountSource')
          }}<select v-model="settings.providerKey" class="feature-input">
            <option :value="undefined">{{ t('liveVoice.ownKey') }}</option>
            <option v-for="account in availableAccounts" :key="account.key" :value="account.key">
              {{ account.displayName || account.name }}
            </option>
          </select></label
        >
        <template v-else-if="settings.adapter === 'doubao-realtime'">
          <div class="feature-grid">
            <label class="feature-field"
              >{{ t('liveVoice.doubaoAppId')
              }}<input
                v-model="doubaoAppId"
                class="feature-input"
                autocomplete="off"
                :placeholder="
                  t(
                    settings.hasCredential
                      ? 'agentSettings.credentialSaved'
                      : 'liveVoice.doubaoAppIdPlaceholder'
                  )
                "
                maxlength="64"
            /></label>
            <label class="feature-field"
              >{{ t('liveVoice.doubaoToken')
              }}<input
                v-model="doubaoToken"
                class="feature-input"
                type="password"
                autocomplete="new-password"
                maxlength="256"
            /></label>
          </div>
          <p class="feature-hint">{{ t('liveVoice.doubaoHint') }}</p>
        </template>
        <p v-else class="feature-hint">{{ t('liveVoice.codexHint') }}</p>
        <label
          v-if="
            !settings.providerKey && (!settings.adapter || settings.adapter === 'openai-realtime')
          "
          class="feature-field"
          >{{ t('agentSettings.voiceEndpoint')
          }}<input
            v-model="settings.endpoint"
            class="feature-input"
            type="url"
            required
            placeholder="https://api.openai.com/v1"
        /></label>
        <div class="feature-grid">
          <label v-if="settings.adapter !== 'codex-live'" class="feature-field"
            >{{ t('agentSettings.voiceModel')
            }}<input
              v-model="settings.model"
              class="feature-input"
              required
              maxlength="128" /></label
          ><label class="feature-field"
            >{{ t('agentSettings.voiceName')
            }}<input v-model="settings.voice" class="feature-input" required maxlength="100"
          /></label>
        </div>
        <label
          v-if="!settings.adapter || settings.adapter === 'openai-realtime'"
          class="feature-field"
          >{{ t('agentSettings.voiceProfile')
          }}<select v-model="settings.profile" class="feature-input">
            <option value="realtime-ga">Realtime GA</option>
            <option value="realtime-compat-v1">Realtime compatibility v1</option>
          </select></label
        >
        <label
          v-if="
            !settings.providerKey &&
            settings.adapter !== 'codex-live' &&
            settings.adapter !== 'doubao-realtime'
          "
          class="feature-field"
          >{{ t('agentSettings.apiKey')
          }}<input
            v-model="apiKey"
            class="feature-input"
            type="password"
            autocomplete="new-password"
            :placeholder="
              t(
                settings.hasCredential
                  ? 'agentSettings.credentialSaved'
                  : 'agentSettings.credentialMissing'
              )
            "
            maxlength="8192"
        /></label>
        <div class="feature-actions">
          <Button type="submit" variant="primary" :disabled="busy || phase !== 'ended'">{{
            t('agentSettings.save')
          }}</Button>
        </div>
      </fieldset>
    </form>
    <div class="feature-card">
      <div class="mb-5 flex items-center gap-3">
        <div
          class="flex size-12 items-center justify-center rounded-full bg-[var(--accent-tint)] text-[var(--accent)]"
        >
          <AudioLines class="size-6" />
        </div>
        <div>
          <h2 class="!mb-1">
            {{ t(`agentSettings.${phase === 'listening' && muted ? 'muted' : phase}`) }}
          </h2>
          <p class="feature-hint">{{ t('agentSettings.voicePrivacy') }}</p>
        </div>
      </div>
      <div class="feature-actions">
        <Button
          v-if="phase === 'ended'"
          variant="primary"
          :disabled="busy || !settings?.enabled || !settings.hasCredential"
          @click="start(t('agentSettings.microphoneError'))"
          ><Mic class="size-4" />{{ t('agentSettings.startCall') }}</Button
        ><template v-else
          ><Button variant="danger" @click="stop"
            ><PhoneOff class="size-4" />{{ t('agentSettings.endCall') }}</Button
          ><Button v-if="phase === 'listening'" @click="toggleMute"
            ><component :is="muted ? MicOff : Mic" class="size-4" />{{
              t(muted ? 'agentSettings.unmute' : 'agentSettings.mute')
            }}</Button
          ></template
        >
      </div>
      <p class="feature-hint mt-4">{{ t('liveVoice.noTarget') }}</p>
    </div>
    <div class="feature-card">
      <h2>{{ t('agentSettings.transcript') }}</h2>
      <p v-if="!transcript.length" class="feature-hint py-6 text-center">
        {{ t('agentSettings.transcriptEmpty') }}
      </p>
      <div role="log" aria-live="polite" class="max-h-[400px] space-y-4 overflow-y-auto">
        <div
          v-for="(item, index) in transcript"
          :key="index"
          class="rounded-lg bg-[var(--bg-base)] p-3"
        >
          <p class="mb-1 text-xs font-semibold text-[var(--accent)]">
            {{ t(`agentSettings.${item.role}`) }}
          </p>
          <p class="whitespace-pre-wrap text-sm leading-relaxed">{{ item.text }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

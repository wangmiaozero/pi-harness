<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AiPreferences } from '@shared/agent-settings/schema'
import { getApi } from '@renderer/composables/useApi'
import Button from '@renderer/components/ui/Button.vue'
import Switch from '@renderer/components/ui/Switch.vue'
import { useSettingsDraft } from '@renderer/components/settings/useSettingsDraft'
import { SETTINGS_DRAFT_KEY } from '@renderer/components/settings/draft-key'
import { provide } from 'vue'
import WorkspaceSettingsSection from '@renderer/components/settings/WorkspaceSettingsSection.vue'
import SettingsFeedback from './SettingsFeedback.vue'
import { useSettingsAction } from './useSettingsAction'
const { t } = useI18n()
const { draft } = useSettingsDraft()
provide(SETTINGS_DRAFT_KEY, draft)
const { busy, error, message, run } = useSettingsAction()
const settings = ref<AiPreferences | null>(null)
const levels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']
const load = () =>
  run(async () => {
    settings.value = await getApi().agentSettings.ai.get()
  })
const save = () =>
  run(async () => {
    settings.value = await getApi().agentSettings.ai.set({ ...settings.value! })
  }, true)
onMounted(load)
</script>
<template>
  <div class="feature-stack">
    <SettingsFeedback :busy="busy" :error="error" :message="message" />
    <Button v-if="!settings && !busy" @click="load">{{ t('agentSettings.retry') }}</Button>
    <form v-if="settings" class="feature-card" @submit.prevent="save">
      <h2>{{ t('agentSettings.ai') }}</h2>
      <fieldset :disabled="busy">
        <label class="feature-row"
          ><span>{{ t('agentSettings.thinking') }}</span
          ><select v-model="settings.defaultThinkingLevel" class="feature-input max-w-44">
            <option v-for="level in levels" :key="level" :value="level">
              {{ t(`agentSettings.${level}`) }}
            </option>
          </select></label
        >
        <div class="feature-row">
          <div>
            <span>{{ t('agentSettings.compaction') }}</span>
            <p class="feature-hint">{{ t('agentSettings.compactionHint') }}</p>
          </div>
          <Switch v-model="settings.compactionEnabled" :label="t('agentSettings.compaction')" />
        </div>
        <div class="feature-grid py-3">
          <label class="feature-field"
            >{{ t('agentSettings.reserveTokens')
            }}<input
              v-model.number="settings.reserveTokens"
              class="feature-input"
              type="number"
              min="1024"
              max="131072"
              required /></label
          ><label class="feature-field"
            >{{ t('agentSettings.keepRecentTokens')
            }}<input
              v-model.number="settings.keepRecentTokens"
              class="feature-input"
              type="number"
              min="1024"
              max="131072"
              required
          /></label>
        </div>
        <div class="feature-row">
          <span>{{ t('agentSettings.retryErrors') }}</span
          ><Switch v-model="settings.retryEnabled" :label="t('agentSettings.retryErrors')" />
        </div>
        <label class="feature-row"
          ><span>{{ t('agentSettings.maxRetries') }}</span
          ><input
            v-model.number="settings.maxRetries"
            class="feature-input max-w-24"
            type="number"
            min="0"
            max="10"
            required
        /></label>
      </fieldset>
      <div class="feature-actions mt-4">
        <Button type="submit" variant="primary" :disabled="busy">{{
          t('agentSettings.save')
        }}</Button
        ><Button :disabled="busy" @click="load">{{ t('agentSettings.reload') }}</Button>
      </div>
    </form>
    <div>
      <h2 class="mb-3 text-sm font-semibold">{{ t('agentSettings.defaults') }}</h2>
      <WorkspaceSettingsSection />
    </div>
    <p class="feature-hint">{{ t('agentSettings.newSessionHint') }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { getApi } from '@renderer/composables/useApi'
import { useChatGptAccounts } from '@renderer/stores/chatgpt-accounts'
import { chatGptGatewaySettingsSchema } from '@shared/providers/advanced-settings'
import Button from '@renderer/components/ui/Button.vue'
import Input from '@renderer/components/ui/Input.vue'
import ProviderAdvancedFields from './ProviderAdvancedFields.vue'
import { advancedProviderDraft, parseAdvancedProviderDraft } from './advanced-provider-draft'

const { t } = useI18n()
const accounts = useChatGptAccounts()
const draft = ref(advancedProviderDraft())
const maxAccounts = ref('')
const busy = ref(false)
const feedback = ref('')
const failed = ref(false)
const loaded = ref(false)

async function load() {
  if (busy.value || loaded.value) return
  busy.value = true
  try {
    const settings = await getApi().accounts.gatewaySettings()
    draft.value = advancedProviderDraft(settings)
    maxAccounts.value = String(settings.maxAccounts ?? '')
    loaded.value = true
    feedback.value = ''
  } catch {
    failed.value = true
    feedback.value = t('providerAccounts.loadFailed')
  } finally {
    busy.value = false
  }
}

async function save() {
  if (busy.value) return
  busy.value = true
  try {
    const parsed = parseAdvancedProviderDraft(draft.value)
    const settings = chatGptGatewaySettingsSchema.parse({
      maxAccounts: maxAccounts.value ? Number(maxAccounts.value) : undefined,
      proxy: parsed.proxy,
      concurrency: parsed.concurrency,
      requestsPerMinute: parsed.requestsPerMinute,
      queueLimit: parsed.queueLimit,
      queueWaitSeconds: parsed.queueWaitSeconds,
      priceMultiplier: parsed.priceMultiplier,
      free: parsed.free,
      billing: parsed.billing,
      rateWindows: parsed.rateWindows,
      redactSecrets: parsed.redactSecrets,
      contextWindows: parsed.contextWindows,
      compactionThresholds: parsed.compactionThresholds
    })
    await getApi().accounts.setGatewaySettings(settings)
    await accounts.load(true)
    failed.value = false
    feedback.value = t('providerAccounts.advancedSaved')
  } catch {
    failed.value = true
    feedback.value = t('providerAccounts.actionFailed')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <details
    class="rounded-lg border border-[var(--border-subtle)] p-3"
    @toggle="($event.target as HTMLDetailsElement).open && load()"
  >
    <summary class="cursor-pointer text-sm font-semibold">
      {{ t('providerAccounts.advancedSettings') }}
    </summary>
    <fieldset v-if="loaded" class="mt-3 space-y-3" :disabled="busy">
      <ProviderAdvancedFields v-model="draft" protocol="openai-responses" chat-gpt>
        <template #limits>
          <Input
            v-model="maxAccounts"
            type="number"
            min="1"
            max="20"
            :label="t('providerAdvanced.maxAccounts')"
            :placeholder="t('providerAdvanced.unlimited')"
          />
        </template>
      </ProviderAdvancedFields>
      <Button size="sm" variant="primary" @click="save">{{ t('common.save') }}</Button>
    </fieldset>
    <p
      v-if="feedback"
      class="mt-2 text-xs text-[var(--text-secondary)]"
      :role="failed ? 'alert' : 'status'"
    >
      {{ feedback }}
    </p>
  </details>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { LocalGatewayState } from '@shared/providers/gateway'
import { getApi, getErrorPayload } from '@renderer/composables/useApi'
import Dialog from '@renderer/components/ui/Dialog.vue'
import Button from '@renderer/components/ui/Button.vue'
import Input from '@renderer/components/ui/Input.vue'

const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const state = ref<LocalGatewayState>({ running: false })
const port = ref('0')
const pending = ref(false)
const error = ref('')
const copied = ref(false)
const accountLimit = ref('')
const queueLimit = ref('')
const queueWait = ref('')

async function run(action: () => Promise<void>) {
  if (pending.value) return
  pending.value = true
  error.value = ''
  try {
    await action()
  } catch (cause) {
    error.value = getErrorPayload(cause).message || t('common.failed')
  } finally {
    pending.value = false
  }
}

async function start() {
  await run(async () => {
    const result = await getApi().providers.startGateway({ port: Number(port.value) })
    state.value = { running: true, baseUrl: result.baseUrl }
  })
}

async function stop() {
  await run(async () => {
    await getApi().providers.stopGateway()
    state.value = { running: false }
    copied.value = false
  })
}

async function saveLimits() {
  await run(async () => {
    const optional = (value: string) => (String(value).trim() === '' ? undefined : Number(value))
    const current = await getApi().accounts.gatewaySettings()
    await getApi().accounts.setGatewaySettings({
      ...current,
      maxAccounts: optional(accountLimit.value) || undefined,
      queueLimit: optional(queueLimit.value),
      queueWaitSeconds: optional(queueWait.value) || undefined
    })
  })
}

onMounted(
  () =>
    void run(async () => {
      const [gateway, limits] = await Promise.all([
        getApi().providers.gatewayState(),
        getApi().accounts.gatewaySettings()
      ])
      state.value = gateway
      accountLimit.value = String(limits.maxAccounts ?? '')
      queueLimit.value = String(limits.queueLimit ?? '')
      queueWait.value = String(limits.queueWaitSeconds ?? '')
    })
)
</script>

<template>
  <Dialog
    :open="true"
    :title="t('providerAdvanced.gateway')"
    @update:open="
      (open) => {
        if (!open) emit('close')
      }
    "
  >
    <div class="space-y-3" data-testid="provider-local-gateway">
      <p class="text-sm text-[var(--text-secondary)]">{{ t('providerAdvanced.gatewayHint') }}</p>
      <Input
        v-if="!state.running"
        v-model="port"
        type="number"
        min="0"
        max="65535"
        :label="t('providerAdvanced.gatewayPort')"
      />
      <template v-else>
        <p role="status" class="text-sm">{{ t('providerAdvanced.gatewayRunning') }}</p>
        <code class="block select-all rounded bg-[var(--bg-hover)] p-2 text-sm">{{
          state.baseUrl
        }}</code>
        <p class="text-xs text-[var(--text-secondary)]">GET /v1/models</p>
      </template>
      <p v-if="error" role="alert" class="text-sm text-[var(--error)]">{{ error }}</p>
      <p v-if="copied" role="status" class="text-sm">{{ t('providerAdvanced.gatewayCopied') }}</p>
      <details class="border-t border-[var(--border-subtle)] pt-3">
        <summary class="cursor-pointer text-sm">{{ t('providerAdvanced.gatewayChatGpt') }}</summary>
        <div class="mt-2 grid grid-cols-3 gap-2">
          <Input
            v-model="accountLimit"
            type="number"
            min="0"
            max="20"
            :label="t('providerAdvanced.maxAccounts')"
          />
          <Input
            v-model="queueLimit"
            type="number"
            min="0"
            max="10000"
            :label="t('providerAdvanced.queueLimit')"
          />
          <Input
            v-model="queueWait"
            type="number"
            min="0"
            max="3600"
            :label="t('providerAdvanced.queueWaitSeconds')"
          />
        </div>
        <Button class="mt-2" size="sm" :disabled="pending" @click="saveLimits">{{
          t('common.save')
        }}</Button>
      </details>
    </div>
    <template #footer>
      <Button v-if="state.running" :loading="pending" @click="stop">{{
        t('providerAdvanced.gatewayStop')
      }}</Button>
      <Button
        v-if="state.running"
        :loading="pending"
        @click="
          run(async () => {
            await getApi().providers.copyGatewayKey()
            copied = true
          })
        "
        >{{ t('providerAdvanced.gatewayCopy') }}</Button
      >
      <Button v-else variant="primary" :loading="pending" @click="start">{{
        t('providerAdvanced.gatewayStart')
      }}</Button>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { getApi } from '@renderer/composables/useApi'
import { useChatGptAccounts } from '@renderer/stores/chatgpt-accounts'
import { formatDateTime } from '@renderer/utils/format'
import type { ChatGptAccount, LocalAccount } from '@shared/providers/account-management'
import Button from '@renderer/components/ui/Button.vue'
import Badge from '@renderer/components/ui/Badge.vue'
import Select from '@renderer/components/ui/Select.vue'
import Dialog from '@renderer/components/ui/Dialog.vue'

const { t, locale } = useI18n()
const accounts = useChatGptAccounts()
const local = shallowRef<LocalAccount[]>([])
const model = ref<Record<string, string>>({})
const scanning = ref(false)
const connecting = ref(false)
const busy = ref('')
const feedback = ref('')
const confirmation = ref<{ id: string; kind: 'verify' | 'disconnect'; modelId?: string } | null>(
  null
)
const names = { codex: 'Codex', claude: 'Claude Code', gemini: 'Gemini CLI' }
const primary = computed(() => accounts.items.find((account) => account.defaultModelId))

function canFallback(account: ChatGptAccount) {
  return (
    !!account.fallbackRank ||
    (primary.value?.id !== account.id &&
      account.models.some(
        (item) =>
          item.id === primary.value?.defaultModelId &&
          item.verified &&
          !item.disabled &&
          !item.unsupported
      ))
  )
}

async function toggleFallback(account: ChatGptAccount) {
  if (busy.value || !canFallback(account)) return
  busy.value = account.id
  feedback.value = ''
  try {
    await getApi().accounts.setFallback({ id: account.id, enabled: !account.fallbackRank })
    await accounts.load(true)
  } catch {
    feedback.value = t('providerAccounts.actionFailed')
  } finally {
    busy.value = ''
  }
}

async function refresh(refresh = false) {
  scanning.value = true
  try {
    const [result] = await Promise.all([
      getApi().accounts.local({ refresh }),
      accounts.load(refresh)
    ])
    local.value = result
  } catch {
    feedback.value = t('providerAccounts.loadFailed')
  } finally {
    scanning.value = false
  }
}

async function connect() {
  connecting.value = true
  feedback.value = t('providerAccounts.browser')
  try {
    await getApi().accounts.connect()
    await accounts.load(true)
    feedback.value = ''
  } catch {
    feedback.value = t('providerAccounts.connectFailed')
  } finally {
    connecting.value = false
  }
}

function selectedModel(account: ChatGptAccount) {
  const selected = model.value[account.id] ?? account.defaultModelId
  return (
    account.models.find((item) => item.id === selected) ??
    account.models.find((item) => !item.unsupported && !item.disabled)
  )
}

function canSetDefault(account: ChatGptAccount) {
  const item = selectedModel(account)
  return (
    !!item?.verified && !item.disabled && !item.unsupported && item.id !== account.defaultModelId
  )
}

async function updateCatalog(id: string) {
  if (busy.value) return
  busy.value = id
  feedback.value = ''
  try {
    await getApi().accounts.refreshCatalog(id)
  } catch {
    feedback.value = t('providerAccounts.catalogFailed')
  } finally {
    try {
      await accounts.load(true)
    } catch {
      feedback.value = t('providerAccounts.loadFailed')
    }
    busy.value = ''
  }
}

async function toggleModel(account: ChatGptAccount) {
  const item = selectedModel(account)
  if (!item?.verified || busy.value) return
  busy.value = account.id
  feedback.value = ''
  try {
    await getApi().accounts.setModelEnabled({
      id: account.id,
      modelId: item.id,
      enabled: !!item.disabled
    })
    await accounts.load(true)
  } catch {
    feedback.value = t('providerAccounts.actionFailed')
  } finally {
    busy.value = ''
  }
}

async function setDefaultModel(account: ChatGptAccount) {
  if (busy.value) return
  const item = selectedModel(account)
  const set = canSetDefault(account)
  if (!set && !account.defaultModelId) return
  busy.value = account.id
  feedback.value = ''
  try {
    await getApi().accounts.setDefaultModel(
      set && item ? { id: account.id, modelId: item.id } : null
    )
    await accounts.load(true)
    accounts.draftModel = null
    accounts.useAccountDefault = true
  } catch {
    feedback.value = t('providerAccounts.actionFailed')
  } finally {
    busy.value = ''
  }
}

async function confirmAction() {
  const action = confirmation.value
  if (!action || busy.value) return
  confirmation.value = null
  busy.value = action.id
  feedback.value = ''
  try {
    if (action.kind === 'verify' && action.modelId) {
      await getApi().accounts.verify({ id: action.id, modelId: action.modelId })
    } else if (action.kind === 'disconnect') {
      const result = await getApi().accounts.disconnect(action.id)
      if (!result.revoked) feedback.value = t('providerAccounts.revocationUnconfirmed')
    }
    await accounts.load(true)
  } catch {
    feedback.value = t('providerAccounts.actionFailed')
  } finally {
    busy.value = ''
  }
}

onMounted(() => void refresh())
</script>

<template>
  <section class="space-y-4 p-5" data-testid="provider-local-accounts">
    <div class="flex items-center justify-between gap-2">
      <h2 class="text-sm font-semibold">{{ $t('providerAccounts.local') }}</h2>
      <Button size="sm" :loading="scanning" @click="refresh(true)">
        {{ $t('providerAccounts.refresh') }}
      </Button>
    </div>
    <div
      v-for="item in local"
      :key="item.source"
      class="flex items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] px-3 py-2"
    >
      <div>
        <strong class="text-sm">{{ names[item.source] }}</strong>
        <p v-if="item.status === 'detected'" class="text-xs text-[var(--text-secondary)]">
          {{ $t(`providerAccounts.detectedHint.${item.source}`) }}
        </p>
      </div>
      <Badge tone="muted">{{ $t(`providerAccounts.localStatus.${item.status}`) }}</Badge>
    </div>
    <div class="flex flex-wrap items-center justify-between gap-2 pt-2">
      <h2 class="text-sm font-semibold">{{ $t('providerAccounts.chatGpt') }}</h2>
      <Button v-if="connecting" size="sm" @click="getApi().accounts.cancel()">
        {{ $t('common.cancel') }}
      </Button>
      <Button v-else variant="primary" size="sm" data-testid="chatgpt-connect" @click="connect">
        {{ $t('providerAccounts.connect') }}
      </Button>
    </div>
    <p class="text-xs text-[var(--text-secondary)]">{{ $t('providerAccounts.chatGptHint') }}</p>
    <p v-if="primary" class="text-xs text-[var(--text-secondary)]">
      {{ $t('providerAccounts.fallbackHint') }}
    </p>
    <p v-if="feedback" role="status" class="text-xs text-[var(--text-secondary)]">{{ feedback }}</p>
    <article
      v-for="account in accounts.items"
      :key="account.id"
      class="space-y-2 rounded-lg border border-[var(--border-subtle)] p-3"
    >
      <div class="flex flex-wrap items-center gap-2">
        <strong class="text-sm">ChatGPT · {{ account.label }}</strong>
        <Badge tone="muted">{{ $t(`providerAccounts.${account.status}`) }}</Badge>
        <Badge v-if="account.defaultModelId" tone="muted">
          {{ $t('providerAccounts.newChatDefault') }} · {{ account.defaultModelId }}
        </Badge>
        <Badge v-if="account.fallbackRank" tone="muted">
          {{ $t('providerAccounts.fallbackPosition', { rank: account.fallbackRank }) }}
        </Badge>
        <Button
          v-if="canFallback(account)"
          size="sm"
          :disabled="!!busy"
          @click="toggleFallback(account)"
        >
          {{
            $t(
              account.fallbackRank
                ? 'providerAccounts.removeFallback'
                : 'providerAccounts.addFallback'
            )
          }}
        </Button>
        <Button
          class="ml-auto"
          size="sm"
          :disabled="!!busy"
          @click="confirmation = { id: account.id, kind: 'disconnect' }"
        >
          {{ $t('providerAccounts.disconnect') }}
        </Button>
      </div>
      <p class="text-xs text-[var(--text-secondary)]">
        {{
          account.catalogFailed
            ? $t('providerAccounts.catalogFailed')
            : account.catalogUpdatedAt
              ? formatDateTime(account.catalogUpdatedAt, locale)
              : $t('providerAccounts.catalogUnconfirmed')
        }}
      </p>
      <div class="flex flex-wrap items-end gap-2">
        <Select
          class="min-w-48 flex-1"
          :model-value="selectedModel(account)?.id"
          :label="
            $t(
              account.catalogUpdatedAt
                ? 'providerAccounts.accountCatalog'
                : 'providerAccounts.catalog'
            )
          "
          :options="
            account.models.map((item) => ({
              value: item.id,
              label: `${item.name} · ${$t(
                item.unsupported
                  ? 'providerAccounts.modelUnsupported'
                  : item.disabled
                    ? 'providerAccounts.modelDisabled'
                    : item.verified
                      ? 'providerAccounts.verified'
                      : 'providerAccounts.unverified'
              )}`
            }))
          "
          @update:model-value="model[account.id] = String($event)"
        />
        <Button
          size="sm"
          :disabled="
            !!busy ||
            !selectedModel(account) ||
            !!selectedModel(account)?.unsupported ||
            !!selectedModel(account)?.disabled
          "
          @click="
            confirmation = { id: account.id, kind: 'verify', modelId: selectedModel(account)?.id }
          "
        >
          {{ $t('providerAccounts.verify') }}
        </Button>
        <Button
          v-if="selectedModel(account)?.verified"
          size="sm"
          :disabled="!!busy"
          @click="toggleModel(account)"
        >
          {{
            $t(
              selectedModel(account)?.disabled
                ? 'providerAccounts.enableModel'
                : 'providerAccounts.disableModel'
            )
          }}
        </Button>
        <Button size="sm" :disabled="!!busy" @click="updateCatalog(account.id)">
          {{ $t('providerAccounts.refreshCatalog') }}
        </Button>
        <Button
          v-if="account.defaultModelId || canSetDefault(account)"
          size="sm"
          :disabled="!!busy"
          @click="setDefaultModel(account)"
        >
          {{
            $t(
              canSetDefault(account)
                ? 'providerAccounts.setDefault'
                : 'providerAccounts.clearDefault'
            )
          }}
        </Button>
      </div>
    </article>
    <Dialog
      :open="!!confirmation"
      :title="$t('providerAccounts.confirm')"
      @update:open="
        (open) => {
          if (!open) confirmation = null
        }
      "
    >
      <p class="text-sm">
        {{
          $t(
            confirmation?.kind === 'verify'
              ? 'providerAccounts.verifyHint'
              : 'providerAccounts.disconnectHint'
          )
        }}
      </p>
      <template #footer>
        <Button size="sm" @click="confirmation = null">{{ $t('common.cancel') }}</Button>
        <Button size="sm" variant="primary" @click="confirmAction">{{
          $t('providerAccounts.confirm')
        }}</Button>
      </template>
    </Dialog>
  </section>
</template>

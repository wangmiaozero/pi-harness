<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { getApi } from '@renderer/composables/useApi'
import { useChatGptAccounts } from '@renderer/stores/chatgpt-accounts'
import { formatDateTime } from '@renderer/utils/format'
import type {
  ChatGptAccount,
  ChatGptRoutingMode,
  LocalAccount
} from '@shared/providers/account-management'
import Button from '@renderer/components/ui/Button.vue'
import Badge from '@renderer/components/ui/Badge.vue'
import Select from '@renderer/components/ui/Select.vue'
import Dialog from '@renderer/components/ui/Dialog.vue'
import Input from '@renderer/components/ui/Input.vue'
import Combobox from '@renderer/components/ui/Combobox.vue'

const props = withDefaults(defineProps<{ focus?: 'chatgpt' | 'claude' | 'gemini' }>(), {
  focus: 'chatgpt'
})
const emit = defineEmits<{ 'configure-api': [] }>()
const { t, locale } = useI18n()
const accounts = useChatGptAccounts()
const local = shallowRef<LocalAccount[]>([])
const model = ref<Record<string, string>>({})
const scanning = ref(false)
const connecting = ref(false)
const busy = ref('')
const feedback = ref('')
const renaming = ref<{ id: string; label: string } | null>(null)
const confirmation = ref<{ id: string; kind: 'verify' | 'disconnect'; modelId?: string } | null>(
  null
)
const names = { codex: 'Codex', claude: 'Claude Code', gemini: 'Gemini CLI' }
const cliSource = computed(() =>
  props.focus === 'claude' ? 'claude' : props.focus === 'gemini' ? 'gemini' : 'codex'
)
const focusedLocal = computed(() => local.value.find((item) => item.source === cliSource.value))
const primary = computed(() => accounts.items.find((account) => account.defaultModelId))
const hasFallback = computed(() => accounts.items.some((account) => account.fallbackRank))

async function changeRouting(mode: ChatGptRoutingMode) {
  if (!primary.value || busy.value || mode === primary.value.routingMode) return
  busy.value = primary.value.id
  feedback.value = ''
  try {
    await getApi().accounts.setRoutingMode(mode)
    await accounts.load(true)
  } catch {
    feedback.value = t('providerAccounts.actionFailed')
  } finally {
    busy.value = ''
  }
}

async function renameAccount() {
  const account = renaming.value
  if (!account?.label.trim() || busy.value) return
  busy.value = account.id
  feedback.value = ''
  try {
    await getApi().accounts.setLabel({ id: account.id, label: account.label.trim() })
    renaming.value = null
    await accounts.load(true)
  } catch {
    feedback.value = t('providerAccounts.actionFailed')
    renaming.value = null
  } finally {
    busy.value = ''
  }
}

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
  const typed = model.value[account.id]
  if (typed !== undefined) return account.models.find((item) => item.id === typed)
  return (
    account.models.find((item) => item.id === account.defaultModelId) ??
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
  <section class="space-y-4" data-testid="provider-local-accounts" :data-provider-focus="focus">
    <div class="flex items-center justify-between gap-2">
      <h2 class="text-sm font-semibold">{{ names[cliSource] }}</h2>
      <Button size="sm" :loading="scanning" @click="refresh(true)">
        {{ $t('providerAccounts.refresh') }}
      </Button>
    </div>
    <div
      v-if="focusedLocal"
      class="flex items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] px-3 py-2"
    >
      <div>
        <strong class="text-sm">{{ names[focusedLocal.source] }}</strong>
        <p v-if="focusedLocal.status === 'detected'" class="text-xs text-[var(--text-secondary)]">
          {{ $t(`providerAccounts.detectedHint.${focusedLocal.source}`) }}
        </p>
      </div>
      <Badge tone="muted">{{ $t(`providerAccounts.localStatus.${focusedLocal.status}`) }}</Badge>
    </div>
    <template v-if="focus !== 'chatgpt'">
      <p class="text-xs text-[var(--text-secondary)]">
        {{ $t(`providerAccounts.subscriptionLimit.${focus}`) }}
      </p>
      <Button size="sm" data-testid="subscription-use-api" @click="emit('configure-api')">
        {{ $t('providerAccounts.useApiPreset') }}
      </Button>
    </template>
    <div v-if="focus === 'chatgpt'" class="flex flex-wrap items-center justify-between gap-2 pt-2">
      <h2 class="text-sm font-semibold">{{ $t('providerAccounts.chatGpt') }}</h2>
      <Button v-if="connecting" size="sm" @click="getApi().accounts.cancel()">
        {{ $t('common.cancel') }}
      </Button>
      <Button v-else variant="primary" size="sm" data-testid="chatgpt-connect" @click="connect">
        {{ $t('providerAccounts.connect') }}
      </Button>
    </div>
    <template v-if="focus === 'chatgpt'">
    <p class="text-xs text-[var(--text-secondary)]">{{ $t('providerAccounts.chatGptHint') }}</p>
    <p v-if="primary" class="text-xs text-[var(--text-secondary)]">
      {{ $t('providerAccounts.fallbackHint') }}
    </p>
    <Select
      v-if="primary && hasFallback"
      class="max-w-xs"
      :label="$t('providerAccounts.routingMode')"
      :model-value="primary.routingMode ?? 'ordered'"
      :disabled="!!busy"
      :options="[
        { value: 'ordered', label: $t('providerAccounts.routingOrdered') },
        { value: 'roundRobin', label: $t('providerAccounts.routingRoundRobin') }
      ]"
      @update:model-value="changeRouting($event === 'roundRobin' ? 'roundRobin' : 'ordered')"
    />
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
          @click="renaming = { id: account.id, label: account.label }"
        >
          {{ $t('providerAccounts.renameAccount') }}
        </Button>
        <Button
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
      <p v-if="account.lastUsedAt" class="text-xs text-[var(--text-secondary)]">
        {{ $t('providerAccounts.lastUsed', { date: formatDateTime(account.lastUsedAt, locale) }) }}
      </p>
      <div class="flex flex-wrap items-end gap-2">
        <Combobox
          class="min-w-48 flex-1"
          :model-value="model[account.id] ?? selectedModel(account)?.id ?? ''"
          :placeholder="$t('common.search')"
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
          @update:model-value="model[account.id] = $event"
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
      <div
        v-if="selectedModel(account)"
        class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--text-secondary)]"
      >
        <span>{{ selectedModel(account)?.name }}</span>
        <span v-if="selectedModel(account)?.contextWindow">
          {{
            $t('providerAccounts.contextWindow', {
              count: selectedModel(account)?.contextWindow?.toLocaleString(locale)
            })
          }}
        </span>
        <span v-if="selectedModel(account)?.maxOutputTokens">
          {{
            $t('providerAccounts.outputLimit', {
              count: selectedModel(account)?.maxOutputTokens?.toLocaleString(locale)
            })
          }}
        </span>
        <span v-if="selectedModel(account)?.thinkingLevels?.length">
          {{
            $t('providerAccounts.thinkingLevels', {
              levels: selectedModel(account)?.thinkingLevels?.join(' / ')
            })
          }}
        </span>
        <span v-if="selectedModel(account)?.vision">{{ $t('providerAccounts.vision') }}</span>
      </div>
    </article>
    <Dialog
      :open="!!renaming"
      :title="$t('providerAccounts.renameAccount')"
      @update:open="
        (open) => {
          if (!open) renaming = null
        }
      "
    >
      <Input
        v-if="renaming"
        v-model="renaming.label"
        :label="$t('providerAccounts.accountName')"
        :maxlength="60"
      />
      <template #footer>
        <Button size="sm" @click="renaming = null">{{ $t('common.cancel') }}</Button>
        <Button
          size="sm"
          variant="primary"
          :disabled="!renaming?.label.trim() || !!busy"
          @click="renameAccount"
        >
          {{ $t('common.save') }}
        </Button>
      </template>
    </Dialog>
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
    </template>
  </section>
</template>

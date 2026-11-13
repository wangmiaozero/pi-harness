<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { getApi } from '@renderer/composables/useApi'
import { useChatGptAccounts } from '@renderer/stores/chatgpt-accounts'
import { useModelsStore } from '@renderer/stores/models'
import { useProvidersStore } from '@renderer/stores/providers'
import { formatDateTime } from '@renderer/utils/format'
import {
  chatGptPlanLabel,
  isSelectableChatGptModel,
  orderChatGptModels
} from '@shared/providers/account-management'
import type {
  ChatGptAccount,
  ChatGptAllowance,
  ChatGptModelPreferences,
  ChatGptResetPolicy,
  ChatGptRoutingMode,
  LocalAccount,
  UsageTotals
} from '@shared/providers/account-management'
import {
  getOfficialModelGroup,
  officialModelGroups,
  officialModelRank
} from '@shared/providers/official-model-groups'
import type { ConnectionTestResult, ProviderProfile } from '@shared/ipc/api-types'
import Button from '@renderer/components/ui/Button.vue'
import Switch from '@renderer/components/ui/Switch.vue'
import Badge from '@renderer/components/ui/Badge.vue'
import Select from '@renderer/components/ui/Select.vue'
import Dialog from '@renderer/components/ui/Dialog.vue'
import Input from '@renderer/components/ui/Input.vue'
import Combobox from '@renderer/components/ui/Combobox.vue'
import AccountModelTest from './AccountModelTest.vue'
import ChatGptModelPreferencesPanel from './ChatGptModelPreferences.vue'
import ChatGptAdvancedSettings from './ChatGptAdvancedSettings.vue'

const props = withDefaults(defineProps<{ focus?: 'chatgpt' | 'claude' | 'gemini' }>(), {
  focus: 'chatgpt'
})
const emit = defineEmits<{ 'configure-api': []; 'edit-provider': [key: string] }>()
const { t, locale } = useI18n()
const accounts = useChatGptAccounts()
const models = useModelsStore()
const providers = useProvidersStore()
const local = shallowRef<LocalAccount[]>([])
const model = ref<Record<string, string>>({})
const scanning = ref(false)
const connecting = ref(false)
const confirmingConnect = ref(false)
const busy = ref('')
const feedback = ref('')
const renaming = ref<{ id: string; label: string } | null>(null)
const disconnecting = ref<string | null>(null)
const resetConfirm = ref<string | null>(null)
const allowances = ref<Record<string, ChatGptAllowance | null>>({})
const allowanceState = ref<Record<string, 'loading' | 'ready' | 'failed'>>({})
const transfer = ref<{ mode: 'import' | 'export'; id?: string } | null>(null)
const transferPassword = ref('')
const localUsage = ref<Record<string, { recent: UsageTotals; weekly: UsageTotals }>>({})
watch(
  () => accounts.maskAccounts,
  (masked) => {
    if (masked) renaming.value = null
  }
)
const test = shallowRef<{
  model: string
  hint: string
  run: () => Promise<ConnectionTestResult | void>
} | null>(null)
const names = { codex: 'Codex', claude: 'Claude Code', gemini: 'Gemini CLI' }
const cliSource = computed(() =>
  props.focus === 'claude' ? 'claude' : props.focus === 'gemini' ? 'gemini' : 'codex'
)
const focusedLocal = computed(() => local.value.find((item) => item.source === cliSource.value))
const primary = computed(() => accounts.items.find((account) => account.defaultModelId))
const hasFallback = computed(() => accounts.items.some((account) => account.fallbackRank))
const official = computed(() =>
  props.focus === 'chatgpt' ? null : officialModelGroups[props.focus]
)
const officialProviders = computed(() =>
  providers.items.filter((provider) => getOfficialModelGroup(provider) === props.focus)
)

function providerModels(provider: ProviderProfile) {
  const group = getOfficialModelGroup(provider)
  if (!group) return []
  return models.items
    .filter((item) => item.providerId === provider.id && item.enabled)
    .sort((a, b) => officialModelRank(group, a.modelId) - officialModelRank(group, b.modelId))
}

function activeProviderModel(provider: ProviderProfile) {
  return models.active.providerKey === provider.key ? models.active.modelId : null
}

function selectedProviderModel(provider: ProviderProfile) {
  const available = providerModels(provider)
  const selected = model.value[provider.id]
  if (selected !== undefined) return available.find((item) => item.modelId === selected)
  return (
    available.find(
      (item) => item.modelId === (activeProviderModel(provider) ?? provider.defaultModelId)
    ) ?? available[0]
  )
}

function testOfficial(provider: ProviderProfile) {
  const item = selectedProviderModel(provider)
  if (!item) return
  test.value = {
    model: item.displayName || item.modelId,
    hint: t('providerAccounts.testApiHint'),
    run: () => providers.testConnection(provider.key, item.modelId)
  }
}

async function setOfficialDefault(provider: ProviderProfile) {
  const item = selectedProviderModel(provider)
  if (!item || !provider.enabled || busy.value) return
  busy.value = provider.id
  feedback.value = ''
  try {
    const result = await models.setActive(provider.key, item.modelId)
    if (result) {
      accounts.draftModel = null
      accounts.useAccountDefault = false
    }
  } catch {
    feedback.value = t('providerAccounts.actionFailed')
  } finally {
    busy.value = ''
  }
}

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
        (item) => item.id === primary.value?.defaultModelId && isSelectableChatGptModel(item)
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
      props.focus === 'chatgpt'
        ? accounts.load(refresh)
        : Promise.all([providers.fetchList(), models.fetchList()])
    ])
    local.value = result
    if (props.focus === 'chatgpt') void loadAllowances()
  } catch {
    feedback.value = t('providerAccounts.loadFailed')
  } finally {
    scanning.value = false
  }
}

async function loadAllowances() {
  const pending = accounts.items.filter((account) => !allowances.value[account.id])
  if (pending.length) {
    allowanceState.value = {
      ...allowanceState.value,
      ...Object.fromEntries(pending.map((account) => [account.id, 'loading']))
    }
  }
  const entries = await Promise.all(
    accounts.items.map(async (account) => {
      try {
        return [account.id, await getApi().accounts.allowance(account.id)] as const
      } catch {
        return [account.id, null] as const
      }
    })
  )
  const next = { ...allowances.value }
  const states = { ...allowanceState.value }
  for (const [id, allowance] of entries) {
    if (allowance) next[id] = allowance
    states[id] = allowance ? 'ready' : next[id] ? 'ready' : 'failed'
  }
  allowances.value = next
  allowanceState.value = states
}

function windowLabel(seconds: number): string {
  if (seconds >= 6 * 24 * 60 * 60) return t('providerAccounts.allowanceWindowWeek')
  return t('providerAccounts.allowanceWindowHours', {
    count: Math.max(1, Math.round(seconds / 3600))
  })
}

function resetIn(at?: number): string {
  if (!at) return ''
  if (at <= Date.now()) return t('providerAccounts.resetPassed')
  const minutes = Math.max(1, Math.round((at - Date.now()) / 60_000))
  if (minutes < 60) return t('providerAccounts.resetInMinutes', { count: minutes })
  const hours = Math.round(minutes / 60)
  if (hours < 48) return t('providerAccounts.resetInHours', { count: hours })
  return t('providerAccounts.resetInDays', { count: Math.round(hours / 24) })
}

function resetCards(accountId: string): { expiresAt?: number }[] {
  const resets = allowances.value[accountId]?.resets
  if (resets?.cards?.length) return resets.cards
  return resets?.expiresAt ? [{ expiresAt: resets.expiresAt }] : []
}

function validUntil(at?: number): string {
  if (!at) return ''
  const when = new Intl.DateTimeFormat(locale.value, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(new Date(at))
  return t('providerAccounts.resetValidUntil', { when })
}

function accountTitle(account: ChatGptAccount): string {
  const email = allowances.value[account.id]?.email
  if (email && !accounts.maskAccounts) return email
  return `ChatGPT · ${accounts.displayLabel(account)}`
}

function allowanceWindows(accountId: string) {
  return [...(allowances.value[accountId]?.windows ?? [])].sort(
    (left, right) => left.seconds - right.seconds
  )
}

async function setResetPolicy(account: ChatGptAccount, patch: Partial<ChatGptResetPolicy>) {
  const current = account.resetPolicy ?? { week: false, expiring: false, leadMinutes: 30 }
  try {
    await getApi().accounts.setResetPolicy({ id: account.id, ...current, ...patch })
    await accounts.load(true)
  } catch {
    feedback.value = t('providerAccounts.actionFailed')
  }
}

function setResetLead(account: ChatGptAccount, value: string) {
  const leadMinutes = Math.min(1440, Math.max(5, Math.round(Number(value)) || 30))
  void setResetPolicy(account, { leadMinutes })
}

function onResetLead(account: ChatGptAccount, event: Event) {
  const value = event.target instanceof HTMLInputElement ? event.target.value : ''
  setResetLead(account, value)
}

async function useReset() {
  const id = resetConfirm.value
  resetConfirm.value = null
  if (!id) return
  busy.value = id
  try {
    const used = await getApi().accounts.useReset(id)
    feedback.value = t(used ? 'providerAccounts.resetUsed' : 'providerAccounts.resetFailed')
    await loadAllowances()
  } catch {
    feedback.value = t('providerAccounts.resetFailed')
  } finally {
    busy.value = ''
  }
}

async function connect() {
  confirmingConnect.value = false
  connecting.value = true
  feedback.value = t('providerAccounts.browser')
  const stop = getApi().accounts.onConnectProgress(() => {
    feedback.value = t('providerAccounts.connectSaving')
  })
  try {
    await getApi().accounts.connect()
    await accounts.load(true)
    void loadAllowances()
    feedback.value = ''
  } catch (error) {
    const details = (
      error as {
        details?: { reason?: string; status?: number; upstreamCode?: string }
      }
    )?.details
    switch (details?.reason) {
      case 'cancelled':
        feedback.value = ''
        break
      case 'rejected':
        feedback.value = t(
          details.upstreamCode === 'unsupported_country_region_territory'
            ? 'providerAccounts.connectProblem.region'
            : 'providerAccounts.connectProblem.rejected',
          { status: details.status }
        )
        break
      case 'timeout':
      case 'network':
      case 'save':
        feedback.value = t(`providerAccounts.connectProblem.${details.reason}`)
        break
      default:
        feedback.value = t('providerAccounts.connectFailed')
    }
  } finally {
    stop()
    connecting.value = false
  }
}

function selectedModel(account: ChatGptAccount) {
  const typed = model.value[account.id]
  if (typed !== undefined) return account.models.find((item) => item.id === typed)
  return (
    account.models.find(
      (item) => item.id === account.defaultModelId && isSelectableChatGptModel(item)
    ) ?? orderChatGptModels(account.models).find(isSelectableChatGptModel)
  )
}

function canSetDefault(account: ChatGptAccount) {
  const item = selectedModel(account)
  return (
    !!item &&
    !account.routingOnly &&
    isSelectableChatGptModel(item) &&
    item.id !== account.defaultModelId
  )
}

async function updateCatalog(id: string) {
  if (busy.value) return
  busy.value = id
  feedback.value = ''
  try {
    await getApi().accounts.refreshCatalog(id)
  } catch (error) {
    if (!(error as { details?: { reason?: string } })?.details?.reason)
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
  if (!item || item.unsupported || busy.value) return
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

async function saveModelPreferences(input: ChatGptModelPreferences): Promise<boolean> {
  if (busy.value) return false
  busy.value = input.id
  feedback.value = ''
  try {
    await getApi().accounts.setModelSelection(input)
    await accounts.load(true)
    return true
  } catch {
    feedback.value = t('providerAccounts.modelSelectionFailed')
    return false
  } finally {
    busy.value = ''
  }
}

async function openChatGptUsage() {
  try {
    await getApi().system.openExternal('https://chatgpt.com/settings/usage')
  } catch {
    feedback.value = t('providerAccounts.actionFailed')
  }
}

function openTransfer(mode: 'import' | 'export', id?: string) {
  transferPassword.value = ''
  transfer.value = { mode, id }
}

async function readLocalUsage(id: string) {
  if (busy.value) return
  busy.value = id
  feedback.value = ''
  const end = Date.now() + 1
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const read = (hours: number) =>
    getApi().accounts.usage({ start: end - hours * 3_600_000, end, provider: id, timeZone })
  try {
    const [recent, weekly] = await Promise.all([read(5), read(7 * 24)])
    localUsage.value[id] = { recent: recent.total, weekly: weekly.total }
  } catch {
    feedback.value = t('providerAccounts.loadFailed')
  } finally {
    busy.value = ''
  }
}

function closeTransfer() {
  if (busy.value) return
  transfer.value = null
  transferPassword.value = ''
}

async function transferAccount() {
  const task = transfer.value
  const password = transferPassword.value
  if (!task || password.length < 12 || busy.value) return
  busy.value = 'transfer'
  feedback.value = ''
  try {
    const api = getApi().accounts
    const done =
      task.mode === 'export' && task.id
        ? await api.exportChatGptAccount({ id: task.id, password })
        : await api.importChatGptAccount({ password })
    if (done) {
      transfer.value = null
      if (task.mode === 'import') await accounts.load(true)
      feedback.value = t(
        task.mode === 'import'
          ? 'providerAccounts.accountImported'
          : 'providerAccounts.accountExported'
      )
    }
  } catch {
    transfer.value = null
    feedback.value = t('providerAccounts.accountTransferFailed')
  } finally {
    transferPassword.value = ''
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

function testChatGpt(account: ChatGptAccount) {
  const item = selectedModel(account)
  if (!item || !isSelectableChatGptModel(item)) return
  test.value = {
    model: item.name,
    hint: t('providerAccounts.verifyHint'),
    run: async () => {
      await getApi().accounts.verify({ id: account.id, modelId: item.id })
      void accounts.load(true).catch(() => {})
    }
  }
}

async function disconnectAccount() {
  const id = disconnecting.value
  if (!id || busy.value) return
  disconnecting.value = null
  busy.value = id
  feedback.value = ''
  try {
    const result = await getApi().accounts.disconnect(id)
    if (!result.revoked) feedback.value = t('providerAccounts.revocationUnconfirmed')
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
    <template v-if="official">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-sm font-semibold">{{ official.name }} API</h2>
        <Button
          size="sm"
          variant="primary"
          data-testid="subscription-use-api"
          @click="emit('configure-api')"
        >
          {{ $t('providerAccounts.configureApi') }}
        </Button>
      </div>
      <p class="text-xs text-[var(--text-secondary)]">
        {{ $t(`providerAccounts.subscriptionLimit.${focus}`) }}
      </p>
      <p v-if="feedback" role="status" class="text-xs text-[var(--text-secondary)]">
        {{ feedback }}
      </p>
      <div
        v-if="!officialProviders.length"
        class="space-y-2 rounded-lg border border-[var(--border-subtle)] p-3"
      >
        <h3 class="text-sm font-medium">{{ $t('providerAccounts.recommendedModels') }}</h3>
        <ul class="flex flex-wrap gap-2">
          <li v-for="item in official.preset.models" :key="item.id">
            <Badge tone="muted">{{ item.name }}</Badge>
          </li>
        </ul>
      </div>
      <article
        v-for="provider in officialProviders"
        :key="provider.id"
        class="space-y-2 rounded-lg border border-[var(--border-subtle)] p-3"
      >
        <div class="flex flex-wrap items-center gap-2">
          <strong class="text-sm">{{ provider.displayName }}</strong>
          <Badge v-if="activeProviderModel(provider)" tone="muted">
            {{ $t('providerAccounts.newChatDefault') }} · {{ activeProviderModel(provider) }}
          </Badge>
          <Button size="sm" class="ml-auto" @click="emit('edit-provider', provider.key)">
            {{ $t('providerAccounts.manageApi') }}
          </Button>
        </div>
        <div class="flex flex-wrap items-end gap-2">
          <Combobox
            class="min-w-48 flex-1"
            :model-value="model[provider.id] ?? selectedProviderModel(provider)?.modelId ?? ''"
            :placeholder="$t('common.search')"
            :label="$t('providerAccounts.accountCatalog')"
            :options="
              providerModels(provider).map((item) => ({
                value: item.modelId,
                label: item.displayName || item.modelId
              }))
            "
            @update:model-value="model[provider.id] = $event"
          />
          <Button
            size="sm"
            :disabled="!selectedProviderModel(provider)"
            @click="testOfficial(provider)"
          >
            {{ $t('providerAccounts.verify') }}
          </Button>
          <Button
            size="sm"
            :disabled="
              !!busy ||
              !provider.enabled ||
              !selectedProviderModel(provider) ||
              activeProviderModel(provider) === selectedProviderModel(provider)?.modelId
            "
            @click="setOfficialDefault(provider)"
          >
            {{ $t('providerAccounts.setDefault') }}
          </Button>
        </div>
        <div
          v-if="selectedProviderModel(provider)"
          class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--text-secondary)]"
        >
          <span v-if="selectedProviderModel(provider)?.contextWindow">
            {{
              $t('providerAccounts.contextWindow', {
                count: selectedProviderModel(provider)?.contextWindow?.toLocaleString(locale)
              })
            }}
          </span>
          <span v-if="selectedProviderModel(provider)?.maxOutputTokens">
            {{
              $t('providerAccounts.outputLimit', {
                count: selectedProviderModel(provider)?.maxOutputTokens?.toLocaleString(locale)
              })
            }}
          </span>
          <span v-if="selectedProviderModel(provider)?.reasoning">{{
            $t('providerAccounts.reasoning')
          }}</span>
          <span v-if="selectedProviderModel(provider)?.vision">{{
            $t('providerAccounts.vision')
          }}</span>
        </div>
      </article>
    </template>
    <div v-if="focus === 'chatgpt'" class="flex flex-wrap items-center justify-between gap-2 pt-2">
      <h2 class="text-sm font-semibold">{{ $t('providerAccounts.chatGpt') }}</h2>
      <Button size="sm" variant="ghost" class="ml-auto" @click="openChatGptUsage">
        {{ $t('providerAccounts.openChatGptUsage') }} ↗
      </Button>
      <Button size="sm" :disabled="!!busy" @click="openTransfer('import')">
        {{ $t('providerAccounts.importAccount') }}
      </Button>
      <Button v-if="connecting" size="sm" @click="getApi().accounts.cancel()">
        {{ $t('common.cancel') }}
      </Button>
      <Button
        v-else
        variant="primary"
        size="sm"
        data-testid="chatgpt-connect"
        @click="confirmingConnect = true"
      >
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
      <p v-if="feedback" role="status" class="text-xs text-[var(--text-secondary)]">
        {{ feedback }}
      </p>
      <article
        v-for="account in accounts.items"
        :key="account.id"
        class="space-y-2 rounded-lg border border-[var(--border-subtle)] p-3"
      >
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
          <strong class="text-sm">{{ accountTitle(account) }}</strong>
          <Badge v-if="allowances[account.id]?.plan" tone="muted">
            {{ chatGptPlanLabel(allowances[account.id]?.plan ?? '') }}
          </Badge>
          <span
            v-for="(usageWindow, index) in allowanceWindows(account.id)"
            :key="usageWindow.seconds + '-' + index"
            class="inline-flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]"
          >
            <span>{{ windowLabel(usageWindow.seconds) }}</span>
            <span class="h-1 w-14 overflow-hidden rounded bg-[var(--bg-hover)]">
              <span
                class="block h-full bg-[var(--text-secondary)]"
                :style="{ width: Math.min(100, usageWindow.usedPercent) + '%' }"
              />
            </span>
            <span>{{
              $t('providerAccounts.allowanceUsed', {
                percent: Math.round(usageWindow.usedPercent)
              })
            }}</span>
            <span v-if="usageWindow.resetAt">{{ resetIn(usageWindow.resetAt) }}</span>
          </span>
          <span
            v-if="!allowanceWindows(account.id).length"
            class="text-xs text-[var(--text-secondary)]"
            role="status"
          >
            {{
              $t(
                allowanceState[account.id] === 'loading'
                  ? 'providerAccounts.allowanceLoading'
                  : 'providerAccounts.allowanceUnread'
              )
            }}
          </span>
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
            @click="
              renaming = { id: account.id, label: accounts.maskAccounts ? '' : account.label }
            "
          >
            {{ $t('providerAccounts.renameAccount') }}
          </Button>
          <Button size="sm" :disabled="!!busy" @click="disconnecting = account.id">
            {{ $t('providerAccounts.disconnect') }}
          </Button>
          <Button size="sm" :disabled="!!busy" @click="openTransfer('export', account.id)">
            {{ $t('providerAccounts.exportAccount') }}
          </Button>
          <Button size="sm" :disabled="!!busy" @click="readLocalUsage(account.id)">
            {{ $t('providerAccounts.localUsage') }}
          </Button>
        </div>
        <div class="space-y-2 rounded-md border border-[var(--border-subtle)] px-2 py-2">
          <div class="flex items-center justify-between gap-3 text-xs">
            <span>{{ $t('providerAccounts.resetWeek') }}</span>
            <Switch
              :model-value="account.resetPolicy?.week ?? false"
              :disabled="!!busy"
              :label="$t('providerAccounts.resetWeek')"
              @update:model-value="setResetPolicy(account, { week: $event })"
            />
          </div>
          <div class="flex items-center justify-between gap-3 text-xs">
            <span>{{ $t('providerAccounts.resetExpiring') }}</span>
            <Switch
              :model-value="account.resetPolicy?.expiring ?? false"
              :disabled="!!busy"
              :label="$t('providerAccounts.resetExpiring')"
              @update:model-value="setResetPolicy(account, { expiring: $event })"
            />
          </div>
          <label
            v-if="account.resetPolicy?.expiring"
            class="flex items-center justify-between gap-3 text-xs"
          >
            <span>{{ $t('providerAccounts.resetLead') }}</span>
            <input
              type="number"
              min="5"
              max="1440"
              class="h-[var(--height-button)] w-20 rounded border border-[var(--border-subtle)] bg-transparent px-2"
              :value="account.resetPolicy.leadMinutes"
              @change="onResetLead(account, $event)"
            />
          </label>
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Button
              size="sm"
              :disabled="!!busy"
              data-testid="chatgpt-use-reset"
              @click="resetConfirm = account.id"
            >
              {{ $t('providerAccounts.resetUse') }}
            </Button>
            <span
              v-for="(card, index) in resetCards(account.id)"
              :key="(card.expiresAt ?? 'open') + '-' + index"
              class="text-xs text-[var(--text-secondary)]"
            >
              {{
                card.expiresAt ? validUntil(card.expiresAt) : $t('providerAccounts.resetNoExpiry')
              }}
            </span>
          </div>
        </div>
        <p v-if="localUsage[account.id]" role="status" class="text-xs text-[var(--text-secondary)]">
          {{
            $t('providerAccounts.accountLocalRequests', {
              recent: localUsage[account.id].recent.requests,
              weekly: localUsage[account.id].weekly.requests
            })
          }}
        </p>
        <p v-if="account.catalogFailed" role="status" class="text-xs text-[var(--text-secondary)]">
          {{
            account.catalogIssue
              ? $t(`providerAccounts.catalogProblem.${account.catalogIssue.reason}`, {
                  status: account.catalogIssue.status
                })
              : $t('providerAccounts.catalogFailed')
          }}
          {{
            $t(
              account.catalogUpdatedAt
                ? 'providerAccounts.catalogCached'
                : 'providerAccounts.catalogBuiltIn'
            )
          }}
        </p>
        <p v-else class="text-xs text-[var(--text-secondary)]">
          {{
            account.catalogUpdatedAt
              ? $t('providerAccounts.catalogRefreshed', {
                  date: formatDateTime(account.catalogUpdatedAt, locale)
                })
              : $t('providerAccounts.catalogUnconfirmed')
          }}
        </p>
        <p v-if="account.lastUsedAt" class="text-xs text-[var(--text-secondary)]">
          {{
            $t('providerAccounts.lastUsed', { date: formatDateTime(account.lastUsedAt, locale) })
          }}
        </p>
        <ChatGptModelPreferencesPanel
          :account="account"
          :busy="!!busy"
          :save="saveModelPreferences"
          @focus-model="model[account.id] = $event"
        />
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
              orderChatGptModels(account.models).map((item) => ({
                value: item.id,
                label:
                  item.unsupported || item.disabled
                    ? `${item.name} · ${$t(
                        item.unsupported
                          ? 'providerAccounts.modelUnsupported'
                          : 'providerAccounts.modelDisabled'
                      )}`
                    : item.name
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
            @click="testChatGpt(account)"
          >
            {{ $t('providerAccounts.verify') }}
          </Button>
          <Button
            v-if="
              selectedModel(account) &&
              !selectedModel(account)?.unsupported &&
              account.modelMode !== 'latest' &&
              account.modelMode !== 'usage'
            "
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
      <div
        v-if="accounts.items.length"
        class="flex flex-wrap items-baseline gap-2 text-xs text-[var(--text-secondary)]"
      >
        <span>Responses</span><code>https://api.openai.com/v1/responses</code>
      </div>
      <ChatGptAdvancedSettings v-if="accounts.items.length" />
      <Dialog
        :open="!!transfer"
        :title="
          $t(
            transfer?.mode === 'export'
              ? 'providerAccounts.exportAccount'
              : 'providerAccounts.importAccount'
          )
        "
        @update:open="(open) => !open && closeTransfer()"
      >
        <p class="mb-3 text-xs text-[var(--text-secondary)]">
          {{ $t('providerAccounts.accountTransferHint') }}
        </p>
        <Input
          v-model="transferPassword"
          type="password"
          :label="$t('providerAccounts.backupPassword')"
          autocomplete="off"
          maxlength="128"
          @keydown.enter.prevent="transferAccount"
        />
        <template #footer>
          <Button :disabled="!!busy" @click="closeTransfer">{{ $t('common.cancel') }}</Button>
          <Button
            variant="primary"
            :loading="busy === 'transfer'"
            :disabled="transferPassword.length < 12"
            @click="transferAccount"
            >{{ $t('common.confirm') }}</Button
          >
        </template>
      </Dialog>
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
        :open="confirmingConnect"
        :title="$t('providerAccounts.authorizeTitle', { name: 'ChatGPT' })"
        @update:open="
          (open) => {
            if (!open) confirmingConnect = false
          }
        "
      >
        <p class="text-sm text-[var(--text-secondary)]">
          {{ $t('providerAccounts.authorizeHint', { name: 'ChatGPT' }) }}
        </p>
        <template #footer>
          <Button size="sm" @click="confirmingConnect = false">{{ $t('common.cancel') }}</Button>
          <Button
            size="sm"
            variant="primary"
            data-testid="chatgpt-connect-confirm"
            @click="connect"
          >
            {{ $t('providerAccounts.authorizeContinue') }}
          </Button>
        </template>
      </Dialog>
      <Dialog
        :open="!!resetConfirm"
        :title="$t('providerAccounts.resetUseTitle')"
        @update:open="
          (open) => {
            if (!open) resetConfirm = null
          }
        "
      >
        <p class="text-sm text-[var(--text-secondary)]">
          {{ $t('providerAccounts.resetUseHint') }}
        </p>
        <template #footer>
          <Button size="sm" @click="resetConfirm = null">{{ $t('common.cancel') }}</Button>
          <Button
            size="sm"
            variant="primary"
            data-testid="chatgpt-use-reset-confirm"
            @click="useReset"
          >
            {{ $t('providerAccounts.resetUse') }}
          </Button>
        </template>
      </Dialog>
      <Dialog
        :open="!!disconnecting"
        :title="$t('providerAccounts.confirm')"
        @update:open="
          (open) => {
            if (!open) disconnecting = null
          }
        "
      >
        <p class="text-sm">
          {{ $t('providerAccounts.disconnectHint') }}
        </p>
        <template #footer>
          <Button size="sm" @click="disconnecting = null">{{ $t('common.cancel') }}</Button>
          <Button size="sm" variant="primary" @click="disconnectAccount">{{
            $t('providerAccounts.confirm')
          }}</Button>
        </template>
      </Dialog>
    </template>
    <AccountModelTest v-if="test" v-bind="test" @close="test = null" />
  </section>
</template>

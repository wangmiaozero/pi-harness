<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { getApi } from '@renderer/composables/useApi'
import { useChatGptAccounts } from '@renderer/stores/chatgpt-accounts'
import { useProvidersStore } from '@renderer/stores/providers'
import { formatDateTime } from '@renderer/utils/format'
import type { QuotaReading, UsageReport, UsageTotals } from '@shared/providers/account-management'
import Button from '@renderer/components/ui/Button.vue'
import Select from '@renderer/components/ui/Select.vue'
import Badge from '@renderer/components/ui/Badge.vue'
import Switch from '@renderer/components/ui/Switch.vue'
import Dialog from '@renderer/components/ui/Dialog.vue'

const { t, locale } = useI18n()
const providers = useProvidersStore()
const accounts = useChatGptAccounts()
const quota = shallowRef<QuotaReading | null>(null)
const report = shallowRef<UsageReport | null>(null)
const provider = ref('')
const period = ref('7')
const usageProvider = ref('')
const usageModel = ref('')
const start = ref('')
const end = ref('')
const loading = ref(false)
const reading = ref(false)
const auto = ref(false)
const usageError = ref(false)
const quotaError = ref(false)
const confirmClear = ref(false)
const clearing = ref(false)
let usageRevision = 0
let quotaRevision = 0

const providerOptions = computed(() =>
  providers.items.map((item) => ({
    value: item.key,
    label: item.displayName
  }))
)
const usageProviderOptions = computed(() => [
  { value: '', label: t('providerAccounts.allProviders') },
  ...[...new Set(report.value?.availableModels.map((model) => model.provider) ?? [])].map((id) => {
    const account = accounts.items.find((item) => item.id === id)
    return {
      value: id,
      label: account
        ? `ChatGPT · ${account.label}`
        : (providers.items.find((item) => item.key === id)?.displayName ?? id)
    }
  })
])
const usageModelOptions = computed(() => [
  { value: '', label: t('providerAccounts.allModels') },
  ...[
    ...new Set(
      report.value?.availableModels
        .filter((model) => !usageProvider.value || model.provider === usageProvider.value)
        .map((model) => model.id) ?? []
    )
  ].map((id) => ({ value: id, label: id }))
])
const tokens = (row: UsageTotals) => row.input + row.output + row.cacheRead + row.cacheWrite
const number = (n: number) => n.toLocaleString(locale.value)
const percent = (n: number) =>
  new Intl.NumberFormat(locale.value, { style: 'percent', maximumFractionDigits: 2 }).format(
    n / 100
  )
const cost = (n: number | null) =>
  n === null
    ? '—'
    : new Intl.NumberFormat(locale.value, {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 6
      }).format(n)
const maxTokens = computed(() =>
  Math.max(1, ...(report.value?.days.map(({ usage }) => tokens(usage)) ?? []))
)
const maxCost = computed(() =>
  Math.max(0.000001, ...(report.value?.days.map(({ usage }) => usage.estimatedCost ?? 0) ?? []))
)

async function loadUsage() {
  const revision = ++usageRevision
  const now = new Date()
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - Number(period.value) + 1)
  if (period.value === 'custom') {
    const a = new Date(start.value + 'T00:00:00')
    const b = new Date(end.value + 'T00:00:00')
    from.setTime(a.getTime())
    to.setTime(b.setDate(b.getDate() + 1))
  }
  if (!(from < to)) {
    usageError.value = true
    report.value = null
    loading.value = false
    return
  }
  loading.value = true
  usageError.value = false
  try {
    const data = await getApi().accounts.usage({
      start: from.getTime(),
      end: to.getTime(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      ...(usageProvider.value ? { provider: usageProvider.value } : {}),
      ...(usageModel.value ? { modelId: usageModel.value } : {})
    })
    if (revision === usageRevision) report.value = data
  } catch {
    if (revision === usageRevision) usageError.value = true
  } finally {
    if (revision === usageRevision) loading.value = false
  }
}

async function readQuota() {
  const revision = ++quotaRevision
  const key = provider.value
  if (!key) return
  reading.value = true
  quotaError.value = false
  try {
    const value = await getApi().accounts.quota(key)
    if (revision === quotaRevision) quota.value = value
  } catch {
    if (revision === quotaRevision) quotaError.value = true
  } finally {
    if (revision === quotaRevision) reading.value = false
  }
}

async function clearUsage() {
  clearing.value = true
  try {
    await getApi().accounts.clearUsage()
    confirmClear.value = false
    await loadUsage()
  } catch {
    usageError.value = true
    confirmClear.value = false
  } finally {
    clearing.value = false
  }
}
watch(provider, () => {
  quotaRevision++
  quota.value = null
  reading.value = false
  quotaError.value = false
})
watch(period, (value) => {
  if (value !== 'custom') void loadUsage()
})
watch([usageProvider, usageModel], () => void loadUsage())
watch(auto, (enabled, _, cleanup) => {
  if (!enabled) return
  const timer = setInterval(() => void readQuota(), 15 * 60_000)
  cleanup(() => clearInterval(timer))
})
onMounted(() => {
  void accounts.load().catch(() => {})
  void loadUsage()
})
onBeforeUnmount(() => {
  usageRevision++
  quotaRevision++
})
</script>

<template>
  <section class="space-y-5 p-5" data-testid="provider-usage-quota">
    <section class="space-y-2 rounded-lg border border-[var(--border-subtle)] p-3">
      <h2 class="text-sm font-semibold">{{ $t('providerAccounts.balance') }}</h2>
      <div class="flex flex-wrap items-end gap-2">
        <Select
          v-model="provider"
          class="min-w-48"
          :label="$t('providers.title')"
          :options="providerOptions"
        />
        <Button size="sm" :disabled="!provider" :loading="reading" @click="readQuota">{{
          $t('providerAccounts.refreshQuota')
        }}</Button>
        <label class="flex items-center gap-2 text-xs">
          <Switch v-model="auto" :label="$t('providerAccounts.auto')" />{{
            $t('providerAccounts.auto')
          }}
        </label>
      </div>
      <p v-if="quotaError" role="alert" class="text-xs">{{ $t('providerAccounts.loadFailed') }}</p>
      <div v-if="quota" class="flex flex-wrap items-center gap-3 text-xs">
        <Badge tone="muted">{{ $t(`providerAccounts.quotaStatus.${quota.status}`) }}</Badge>
        <span v-for="item in quota.balances" :key="item.currency"
          >{{ item.available }} {{ item.currency }}</span
        >
        <template v-if="quota.keyLimit">
          <span
            >{{ $t('providerAccounts.keySpend') }} {{ cost(quota.keyLimit.usage ?? null) }}</span
          >
          <span>{{ $t('providerAccounts.keyCap') }} {{ cost(quota.keyLimit.limit ?? null) }}</span>
          <span
            >{{ $t('providerAccounts.keyRemaining') }}
            {{ cost(quota.keyLimit.remaining ?? null) }}</span
          >
          <span v-if="quota.keyLimit.resetPeriod">{{
            $t(`providerAccounts.resetPeriod.${quota.keyLimit.resetPeriod}`)
          }}</span>
        </template>
        <span v-if="quota.checkedAt && quota.source"
          >{{ $t(`providerAccounts.quotaSource.${quota.source}`) }} ·
          {{ formatDateTime(quota.checkedAt, locale) }}</span
        >
      </div>
      <ul v-if="quota?.windows?.length" class="space-y-1 text-xs">
        <li v-for="(window, index) in quota.windows" :key="index" class="flex flex-wrap gap-2">
          <strong
            >{{ window.model }} · {{ $t(`providerAccounts.quotaWindow.${window.window}`) }}</strong
          >
          <span v-if="window.availability && window.availability !== 'limited'">
            {{ $t(`providerAccounts.quotaWindow.${window.availability}`) }}
          </span>
          <span v-else>
            {{ $t('providerAccounts.keyRemaining') }}
            {{ window.remainingPercent === undefined ? '—' : percent(window.remainingPercent) }}
          </span>
          <span>
            {{ $t('providerAccounts.quotaWindow.reset') }}
            {{ window.resetAt ? formatDateTime(window.resetAt, locale) : '—' }}
          </span>
        </li>
      </ul>
    </section>
    <section class="space-y-2 rounded-lg border border-[var(--border-subtle)] p-3">
      <h2 class="text-sm font-semibold">{{ $t('providerAccounts.subscription') }}</h2>
      <button
        class="text-xs text-[var(--accent)] underline"
        type="button"
        @click="getApi().system.openExternal('https://chatgpt.com/settings/usage')"
      >
        {{ $t('providerAccounts.openChatGptUsage') }}
      </button>
    </section>
    <section class="space-y-3 rounded-lg border border-[var(--border-subtle)] p-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-sm font-semibold">{{ $t('providerAccounts.localUsage') }}</h2>
        <div class="flex flex-wrap items-center gap-2">
          <Select
            v-model="period"
            class="min-w-36"
            :aria-label="$t('providerAccounts.range')"
            :options="
              ['1', '7', '30', 'custom'].map((value) => ({
                value,
                label: $t(`providerAccounts.range_${value}`)
              }))
            "
          />
          <Button size="sm" :loading="loading" @click="loadUsage">{{
            $t('providerAccounts.refresh')
          }}</Button>
          <Button size="sm" :disabled="!report?.retainedRuns" @click="confirmClear = true">
            {{ $t('providerAccounts.clearUsage') }}
          </Button>
        </div>
      </div>
      <div v-if="report" class="flex flex-wrap gap-2">
        <Select
          v-model="usageProvider"
          class="min-w-44"
          :label="$t('providerAccounts.providerFilter')"
          :options="usageProviderOptions"
          @update:model-value="usageModel = ''"
        />
        <Select
          v-model="usageModel"
          class="min-w-44"
          :label="$t('providerAccounts.modelFilter')"
          :options="usageModelOptions"
        />
      </div>
      <div v-if="period === 'custom'" class="flex flex-wrap gap-3 text-xs">
        <label
          >{{ $t('providerAccounts.from') }}
          <input
            v-model="start"
            type="date"
            class="rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-1"
        /></label>
        <label
          >{{ $t('providerAccounts.to') }}
          <input
            v-model="end"
            type="date"
            class="rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-1"
        /></label>
      </div>
      <p v-if="usageError" role="alert" class="text-xs">{{ $t('providerAccounts.loadFailed') }}</p>
      <template v-if="report">
        <p class="text-xs text-[var(--text-secondary)]">
          {{
            $t('providerAccounts.retained', {
              count: report.retainedRuns,
              legacy: report.legacyRuns
            })
          }}
        </p>
        <dl class="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <div
            v-for="(value, label) in {
              requests: number(report.total.requests),
              succeeded: number(report.total.succeeded),
              failed: number(report.total.failed),
              aborted: number(report.total.aborted),
              tokens: number(tokens(report.total)),
              input: number(report.total.input),
              output: number(report.total.output),
              cacheRead: number(report.total.cacheRead),
              cacheWrite: number(report.total.cacheWrite),
              cost: cost(report.total.estimatedCost)
            }"
            :key="label"
          >
            <dt class="text-[var(--text-secondary)]">
              {{ $t(`providerAccounts.metrics.${label}`) }}
            </dt>
            <dd class="font-semibold tabular-nums">{{ value }}</dd>
          </div>
        </dl>
        <div
          v-if="report.days.length"
          class="space-y-1 border-t border-[var(--border-subtle)] pt-2 text-xs"
        >
          <h3 class="font-semibold">{{ $t('providerAccounts.trend') }}</h3>
          <div
            v-for="{ day, usage } in report.days"
            :key="day"
            class="grid grid-cols-[6rem_1fr_1fr] items-center gap-2"
          >
            <time :datetime="day">{{ day }}</time>
            <div class="relative isolate rounded bg-[var(--bg-surface)] px-2">
              <span
                aria-hidden="true"
                class="absolute inset-y-0 left-0 -z-10 rounded bg-[var(--accent)] opacity-20"
                :style="{ width: (tokens(usage) / maxTokens) * 100 + '%' }"
              />
              {{ number(tokens(usage)) }} {{ $t('providerAccounts.metrics.tokens') }}
            </div>
            <div class="relative isolate rounded bg-[var(--bg-surface)] px-2">
              <span
                aria-hidden="true"
                class="absolute inset-y-0 left-0 -z-10 rounded bg-[var(--success)] opacity-20"
                :style="{ width: ((usage.estimatedCost ?? 0) / maxCost) * 100 + '%' }"
              />
              {{ cost(usage.estimatedCost) }}
            </div>
          </div>
        </div>
        <details v-if="report.providers.length" class="text-xs">
          <summary class="cursor-pointer font-semibold">
            {{ $t('providerAccounts.byProvider') }}
          </summary>
          <dl
            v-for="{ id, usage } in report.providers"
            :key="id"
            class="flex justify-between gap-2 py-1"
          >
            <dt>{{ providers.items.find((item) => item.key === id)?.displayName ?? id }}</dt>
            <dd class="tabular-nums">
              {{ number(tokens(usage)) }} · {{ cost(usage.estimatedCost) }}
            </dd>
          </dl>
        </details>
        <details v-if="report.models.length" class="text-xs">
          <summary class="cursor-pointer font-semibold">
            {{ $t('providerAccounts.byModel') }}
          </summary>
          <dl
            v-for="{ provider: key, id, usage } in report.models"
            :key="key + '/' + id"
            class="flex justify-between gap-2 py-1"
          >
            <dt>{{ key }} / {{ id }}</dt>
            <dd class="tabular-nums">
              {{ number(tokens(usage)) }} · {{ cost(usage.estimatedCost) }}
            </dd>
          </dl>
        </details>
      </template>
    </section>
    <Dialog v-model:open="confirmClear" :title="$t('providerAccounts.clearUsage')">
      <p class="text-sm">{{ $t('providerAccounts.clearUsageHint') }}</p>
      <template #footer>
        <Button size="sm" :disabled="clearing" @click="confirmClear = false">{{
          $t('common.cancel')
        }}</Button>
        <Button size="sm" variant="primary" :loading="clearing" @click="clearUsage">{{
          $t('providerAccounts.confirm')
        }}</Button>
      </template>
    </Dialog>
  </section>
</template>

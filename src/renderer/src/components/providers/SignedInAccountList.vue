<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ChatGptAccount, ChatGptAllowance } from '@shared/providers/account-management'
import { chatGptPlanLabel, isSelectableChatGptModel } from '@shared/providers/account-management'
import { getApi } from '@renderer/composables/useApi'
import { useChatGptAccounts } from '@renderer/stores/chatgpt-accounts'
import Badge from '@renderer/components/ui/Badge.vue'

const emit = defineEmits<{ open: [] }>()
const { t, locale } = useI18n()
const accounts = useChatGptAccounts()
const allowances = ref<Record<string, ChatGptAllowance | null>>({})

onMounted(() => {
  void accounts.load().then(loadAllowances)
})
watch(
  () => accounts.items.map((account) => account.id).join(','),
  () => void loadAllowances()
)

async function loadAllowances() {
  const entries = await Promise.all(
    accounts.items.map(async (account) => {
      try {
        return [account.id, await getApi().accounts.allowance(account.id)] as const
      } catch {
        return [account.id, null] as const
      }
    })
  )
  allowances.value = Object.fromEntries(entries)
}

function title(account: ChatGptAccount): string {
  const email = allowances.value[account.id]?.email
  const name = email && !accounts.maskAccounts ? email : accounts.displayLabel(account)
  return t('providerAccounts.signedInAccount', {
    email: name,
    count: account.models.filter(isSelectableChatGptModel).length
  })
}

function windowLabel(seconds: number): string {
  if (seconds >= 6 * 24 * 60 * 60) return t('providerAccounts.allowanceWindowWeek')
  return t('providerAccounts.allowanceWindowHours', {
    count: Math.max(1, Math.round(seconds / 3600))
  })
}

function resetIn(at?: number): string {
  if (!at || at <= Date.now()) return ''
  const minutes = Math.max(1, Math.round((at - Date.now()) / 60_000))
  if (minutes < 60) return t('providerAccounts.resetInMinutes', { count: minutes })
  const hours = Math.round(minutes / 60)
  if (hours < 48) return t('providerAccounts.resetInHours', { count: hours })
  return t('providerAccounts.resetInDays', { count: Math.round(hours / 24) })
}

function allowanceLine(accountId: string): string {
  const allowance = allowances.value[accountId]
  if (!allowance?.windows.length) return ''
  return [...allowance.windows]
    .sort((left, right) => left.seconds - right.seconds)
    .map((usageWindow) => {
      const used = t('providerAccounts.allowanceUsed', {
        percent: Math.round(usageWindow.usedPercent)
      })
      const when = resetIn(usageWindow.resetAt)
      return [windowLabel(usageWindow.seconds), used, when].filter(Boolean).join(' ')
    })
    .join(' · ')
}

function resetLine(accountId: string): string {
  const resets = allowances.value[accountId]?.resets
  if (!resets || (!resets.count && !resets.expiresAt)) return ''
  const count = t('providerAccounts.resetCount', { count: resets.count })
  if (!resets.expiresAt) return count
  const when = new Intl.DateTimeFormat(locale.value, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(new Date(resets.expiresAt))
  return `${count} · ${t('providerAccounts.resetValidUntil', { when })}`
}
</script>

<template>
  <div v-if="accounts.items.length" class="space-y-1" data-testid="signed-in-accounts">
    <button
      v-for="account in accounts.items"
      :key="account.id"
      type="button"
      class="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-[var(--bg-hover)]"
      @click="emit('open')"
    >
      <span class="min-w-0 flex-1">
        <span class="block text-[13px] font-medium text-[var(--text-primary)]">Codex</span>
        <span class="block truncate text-[12px] text-[var(--text-secondary)]">{{
          title(account)
        }}</span>
        <span
          v-if="allowanceLine(account.id)"
          class="block truncate text-[12px] text-[var(--text-secondary)]"
        >
          {{ allowanceLine(account.id) }}
        </span>
        <span
          v-if="resetLine(account.id)"
          class="block truncate text-[12px] text-[var(--text-tertiary)]"
        >
          {{ resetLine(account.id) }}
        </span>
      </span>
      <Badge v-if="allowances[account.id]?.plan" tone="muted">
        {{ chatGptPlanLabel(allowances[account.id]?.plan ?? '') }}
      </Badge>
    </button>
  </div>
</template>

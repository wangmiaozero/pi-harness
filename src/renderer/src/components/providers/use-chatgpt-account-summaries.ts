import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  chatGptPlanLabel,
  chatGptRemainingPercent,
  isSelectableChatGptModel
} from '@shared/providers/account-management'
import { useChatGptAccounts } from '@renderer/stores/chatgpt-accounts'

export function useChatGptAccountSummaries() {
  const { t, locale } = useI18n()
  const accounts = useChatGptAccounts()

  watch(
    () => accounts.items.map(({ id }) => id).join(','),
    () => void accounts.loadAllowances(),
    { immediate: true }
  )

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
    const allowance = accounts.allowances[accountId]?.data
    if (!allowance?.windows.length) return ''
    return [...allowance.windows]
      .sort((left, right) => left.seconds - right.seconds)
      .map((usageWindow) => {
        const remaining = t('providerAccounts.allowanceRemaining', {
          percent: chatGptRemainingPercent(usageWindow.usedPercent)
        })
        const when = resetIn(usageWindow.resetAt)
        return [windowLabel(usageWindow.seconds), remaining, when].filter(Boolean).join(' ')
      })
      .join(' · ')
  }

  function resetLine(accountId: string): string {
    const resets = accounts.allowances[accountId]?.data?.resets
    const cards = resets?.cards?.length
      ? resets.cards
      : resets?.expiresAt
        ? [{ expiresAt: resets.expiresAt }]
        : []
    if (!resets || (!resets.count && !cards.length)) return ''
    const count = t('providerAccounts.resetCount', { count: resets.count })
    const times = cards.map((card) => {
      if (!card.expiresAt) return t('providerAccounts.resetNoExpiry')
      const when = new Intl.DateTimeFormat(locale.value, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
      }).format(new Date(card.expiresAt))
      return t('providerAccounts.resetValidUntil', { when })
    })
    return [count, ...times].join(' · ')
  }

  return computed(() =>
    accounts.items.map((account) => {
      const reading = accounts.allowances[account.id]
      const email = !accounts.maskAccounts ? reading?.data?.email : undefined
      const label = accounts.displayLabel(account)
      const name = email || label
      const reconnect = reading?.status === 'authorization'
      return {
        id: account.id,
        subtitle: [name, allowanceLine(account.id), resetLine(account.id)]
          .filter(Boolean)
          .join(' · '),
        searchTerms: [label, name, 'ChatGPT'],
        modelCount: account.models.filter(isSelectableChatGptModel).length,
        badge: reconnect
          ? t('providerAccounts.quotaStatus.unauthorized')
          : chatGptPlanLabel(reading?.data?.plan ?? '') || t('providerAccounts.chatGpt'),
        reconnect,
        updatedAt: account.catalogUpdatedAt
      }
    })
  )
}

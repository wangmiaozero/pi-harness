import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { getApi, getErrorPayload } from '@renderer/composables/useApi'
import {
  isSelectableChatGptModel,
  type ChatGptAccount,
  type ChatGptAllowance
} from '@shared/providers/account-management'

type AllowanceReading = {
  data: ChatGptAllowance | null
  status: 'loading' | 'ready' | 'failed' | 'authorization'
}

export const useChatGptAccounts = defineStore('chatgpt-accounts', () => {
  const items = shallowRef<ChatGptAccount[]>([])
  const allowances = shallowRef<Record<string, AllowanceReading>>({})
  const pendingAllowances = new Map<string, Promise<void>>()
  const draftModel = shallowRef<{ provider: string; modelId: string } | null>(null)
  const useAccountDefault = ref(true)
  const maskAccounts = ref(localStorage.getItem('pi-harness.accounts.masked') === 'true')

  function toggleMaskAccounts() {
    maskAccounts.value = !maskAccounts.value
    localStorage.setItem('pi-harness.accounts.masked', String(maskAccounts.value))
  }

  function displayLabel(account: ChatGptAccount) {
    return maskAccounts.value ? `•••• ${account.id.slice(-4)}` : account.label
  }
  const defaultDraftModel = computed(() => {
    if (!useAccountDefault.value) return null
    const account = items.value.find((item) => item.defaultModelId)
    return account?.defaultModelId
      ? { provider: account.id, modelId: account.defaultModelId }
      : null
  })
  const effectiveDraftModel = computed(() => {
    if (draftModel.value) return draftModel.value
    if (defaultDraftModel.value || !useAccountDefault.value) return defaultDraftModel.value
    const account = items.value.find(
      (item) => !item.routingOnly && item.models.some(isSelectableChatGptModel)
    )
    const modelId =
      account?.recommendedModelId ?? account?.models.find(isSelectableChatGptModel)?.id
    return account && modelId ? { provider: account.id, modelId } : null
  })
  let loaded = false
  let pending: Promise<void> | null = null

  function setAllowance(id: string, reading: AllowanceReading) {
    if (items.value.some((account) => account.id === id))
      allowances.value = { ...allowances.value, [id]: reading }
  }

  function loadAllowance(
    id: string,
    refresh: boolean,
    keepPrevious = true
  ): Promise<void> | undefined {
    const inFlight = pendingAllowances.get(id)
    if (inFlight) return inFlight
    const previous = allowances.value[id]
    if (previous && !refresh) return

    const data = keepPrevious ? (previous?.data ?? null) : null
    setAllowance(id, { data, status: 'loading' })
    const request = getApi()
      .accounts.allowance(id)
      .then((result) => {
        setAllowance(id, { data: result ?? data, status: result || data ? 'ready' : 'failed' })
      })
      .catch((error: unknown) => {
        const details = getErrorPayload(error).details as { reason?: string } | undefined
        setAllowance(
          id,
          details?.reason === 'authorization'
            ? { data: null, status: 'authorization' }
            : { data, status: data ? 'ready' : 'failed' }
        )
      })
      .finally(() => {
        pendingAllowances.delete(id)
      })

    pendingAllowances.set(id, request)
    return request
  }

  async function loadAllowances(refresh = false): Promise<void> {
    await Promise.all(items.value.map(({ id }) => loadAllowance(id, refresh)))
  }

  async function refreshAllowance(id: string): Promise<void> {
    // A request started before the reset cannot supply the result after it.
    await pendingAllowances.get(id)
    if (items.value.some((account) => account.id === id)) await loadAllowance(id, true, false)
  }

  async function load(refresh = false): Promise<void> {
    if (pending) {
      if (!refresh) return pending
      await pending.catch(() => {})
    }
    if (loaded && !refresh) return
    pending = getApi()
      .accounts.chatGpt()
      .then((result) => {
        items.value = result
        const ids = new Set(result.map(({ id }) => id))
        allowances.value = Object.fromEntries(
          Object.entries(allowances.value).filter(([id]) => ids.has(id))
        )
        if (
          draftModel.value &&
          !result.some(
            (account) =>
              account.id === draftModel.value?.provider &&
              !account.routingOnly &&
              account.models.some(
                (model) => model.id === draftModel.value?.modelId && isSelectableChatGptModel(model)
              )
          )
        )
          draftModel.value = null
        loaded = true
      })
      .finally(() => {
        pending = null
      })
    return pending
  }

  return {
    items,
    allowances,
    loadAllowances,
    refreshAllowance,
    draftModel,
    defaultDraftModel,
    effectiveDraftModel,
    useAccountDefault,
    maskAccounts,
    toggleMaskAccounts,
    displayLabel,
    load
  }
})

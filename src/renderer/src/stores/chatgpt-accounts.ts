import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { getApi } from '@renderer/composables/useApi'
import { isSelectableChatGptModel, type ChatGptAccount } from '@shared/providers/account-management'

export const useChatGptAccounts = defineStore('chatgpt-accounts', () => {
  const items = shallowRef<ChatGptAccount[]>([])
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

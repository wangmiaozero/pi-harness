import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { getApi } from '@renderer/composables/useApi'
import type { ChatGptAccount } from '@shared/providers/account-management'

export const useChatGptAccounts = defineStore('chatgpt-accounts', () => {
  const items = shallowRef<ChatGptAccount[]>([])
  const draftModel = shallowRef<{ provider: string; modelId: string } | null>(null)
  const useAccountDefault = ref(true)
  const effectiveDraftModel = computed(() => {
    if (draftModel.value || !useAccountDefault.value) return draftModel.value
    const account = items.value.find((item) => item.defaultModelId)
    return account?.defaultModelId
      ? { provider: account.id, modelId: account.defaultModelId }
      : null
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
        loaded = true
      })
      .finally(() => {
        pending = null
      })
    return pending
  }

  return { items, draftModel, effectiveDraftModel, useAccountDefault, load }
})

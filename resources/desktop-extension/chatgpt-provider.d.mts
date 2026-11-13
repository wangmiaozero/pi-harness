import type { Provider } from '@earendil-works/pi-ai'
import type { ChatGptAccount } from '../../src/shared/providers/account-management'

type FetchResponses = (id: string, modelId: string, init?: RequestInit) => Promise<Response>
export function createChatGptProvider(
  account: ChatGptAccount,
  fetchResponses: FetchResponses
): Provider
export function chatGptProviderSync(
  register: (provider: Provider) => void,
  unregister: (id: string) => void,
  list: () => Promise<ChatGptAccount[]>,
  fetchResponses: FetchResponses
): () => Promise<void>

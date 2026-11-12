import type { Provider } from '@earendil-works/pi-ai'
import type { ChatGptAccount } from '../../src/shared/providers/account-management'

type Resolve = (id: string, modelId: string) => Promise<string>
export function createChatGptProvider(account: ChatGptAccount, resolve: Resolve): Provider
export function chatGptProviderSync(
  register: (provider: Provider) => void,
  unregister: (id: string) => void,
  list: () => Promise<ChatGptAccount[]>,
  resolve: Resolve
): () => Promise<void>

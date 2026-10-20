import type { Provider, Model, TranscriptContext } from '@earendil-works/pi-ai'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { OpenCodeFreeState } from '../../src/shared/providers/opencode-free'
export function readState(file?: string): Promise<OpenCodeFreeState>
export function runtimeModels(state: OpenCodeFreeState): Model<'openai-completions'>[]
export function createOpenCodeProvider(options?: {
  state?: () => Promise<OpenCodeFreeState>
  fetcher?: typeof fetch
  probe?: boolean
  resolveKey?: () => Promise<string | undefined>
}): Provider<'openai-completions'>
export function registerOpenCode(
  pi: ExtensionAPI,
  options?: { resolveKey: () => Promise<string | undefined> }
): Promise<void>
export function messagesFor(
  model: Model<'openai-completions'>,
  context: TranscriptContext
): unknown[]
export function sse(response: Response): AsyncGenerator<unknown>

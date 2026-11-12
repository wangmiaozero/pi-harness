import path from 'node:path'
import type { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { providerKeySchema } from '@shared/schemas/domain'
import { PI_FILES } from '@shared/constants/index'
import { managedProviderSecretId, secretStore } from '../security/secret-store'
import { readTextFile } from '../services/storage'

interface ManagedProviderKey {
  provider: string
  baseUrl: string | undefined
  apiKey: string | null
}

export async function readManagedProviderKeys(agentDir: string): Promise<ManagedProviderKey[]> {
  if (!path.isAbsolute(agentDir)) return []
  const raw = await readTextFile(path.join(agentDir, PI_FILES.models)).catch(() => null)
  // Pi reports invalid native configuration through its usual model diagnostics.
  let providers: Record<string, { apiKey?: string; baseUrl?: string }>
  try {
    providers = raw ? (JSON.parse(raw)?.providers ?? {}) : {}
  } catch {
    return []
  }
  const keys: ManagedProviderKey[] = []
  for (const [provider, config] of Object.entries(providers)) {
    if (!providerKeySchema.safeParse(provider).success || typeof config?.apiKey !== 'string')
      continue
    const id = managedProviderSecretId(config.apiKey)
    if (!id) continue
    const baseUrl = typeof config.baseUrl === 'string' ? config.baseUrl : undefined
    const apiKey = baseUrl
      ? await secretStore.getProviderSecret(id, baseUrl, true).catch(() => null)
      : null
    keys.push({ provider, baseUrl, apiKey })
  }
  return keys
}

/** Install overrides in Pi's memory-only credential layer for SDK consumers. */
export async function loadManagedProviderKeys(
  runtime: Pick<ModelRuntime, 'setRuntimeApiKey' | 'registerProvider'>,
  agentDir: string
): Promise<Set<string>> {
  const unavailable = new Set<string>()
  for (const { provider, apiKey, baseUrl } of await readManagedProviderKeys(agentDir)) {
    if (apiKey && baseUrl) {
      runtime.registerProvider(provider, { baseUrl })
      await runtime.setRuntimeApiKey(provider, apiKey)
    } else unavailable.add(provider)
  }
  return unavailable
}

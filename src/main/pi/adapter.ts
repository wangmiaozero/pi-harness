/**
 * Pi Config Adapter — Domain ↔ Pi native config translation.
 *
 * Writes ONLY fields Pi understands into models.json / settings.json.
 * Pi-Harness-only metadata stays in the metadata store.
 */

import type { ProtocolId } from '@shared/constants/protocols'
import type { ApiKeySpec, ModelDefinition, ProviderProfile } from '@shared/types/domain'
import type { PiModelConfig, PiProviderConfig } from '@shared/types/pi'
import { isProtocolId } from '@shared/constants/protocols'
import { resolveModelInput } from '@shared/constants/provider-presets'
import type { ModelMeta, ProviderMeta } from '../services/metadata-store'
import { modelMetaKey } from '../services/metadata-store'
import { macKeychainCommand, maskKey, secretStore } from '../security/secret-store'

export function serialiseApiKey(
  spec: ApiKeySpec | null,
  secretId: string | null
): string | undefined {
  if (!spec) return undefined
  switch (spec.kind) {
    case 'literal':
      return spec.literal
    case 'env':
      return spec.envRef
    case 'command':
      return spec.command
    case 'stored':
      if (!secretId) return undefined
      // macOS prefers !command; non-mac resolves later via secretStore.serialisedApiKeyValue
      if (process.platform === 'darwin') return macKeychainCommand(secretId)
      return undefined // caller must resolve asynchronously
    default:
      return undefined
  }
}

export async function resolveApiKeyForPi(
  spec: ApiKeySpec | null,
  secretId: string | null
): Promise<string | undefined> {
  if (!spec) return undefined
  if (spec.kind === 'stored' && secretId) {
    return secretStore.serialisedApiKeyValue(secretId)
  }
  return serialiseApiKey(spec, secretId)
}

export function parseApiKeyFromPi(raw: string | undefined): {
  apiKey: ApiKeySpec | null
  apiKeyRef: string | null
} {
  if (!raw) return { apiKey: null, apiKeyRef: null }
  if (raw.startsWith('!')) {
    // Pi-Harness managed keychain
    const m = raw.match(/-s\s+"pi-harness-([^"]+)"/)
    if (m?.[1]) {
      return {
        apiKey: { kind: 'stored', command: raw },
        apiKeyRef: m[1]
      }
    }
    // Any other !security Keychain command — keep as command, UI treats as keychain
    return { apiKey: { kind: 'command', command: raw }, apiKeyRef: null }
  }
  if (raw.startsWith('$') || raw.startsWith('${')) {
    return { apiKey: { kind: 'env', envRef: raw }, apiKeyRef: null }
  }
  // Never ship plaintext literal into the domain object exposed to renderer.
  return { apiKey: { kind: 'literal' }, apiKeyRef: null }
}

export function providerToDomain(
  key: string,
  pi: PiProviderConfig,
  meta: ProviderMeta | undefined
): ProviderProfile {
  const parsed = parseApiKeyFromPi(pi.apiKey)
  const apiKeyRef = parsed.apiKeyRef ?? meta?.apiKeyRef ?? null
  const apiKey = parsed.apiKey
    ? {
        kind:
          parsed.apiKey.kind === 'literal' && apiKeyRef ? ('stored' as const) : parsed.apiKey.kind,
        envRef: parsed.apiKey.envRef,
        command: parsed.apiKey.command
      }
    : apiKeyRef
      ? { kind: 'stored' as const }
      : null
  const protocol: ProtocolId = isProtocolId(pi.api ?? '')
    ? (pi.api as ProtocolId)
    : 'openai-completions'
  const now = Date.now()
  return {
    id: key,
    key,
    name: meta?.name ?? meta?.displayName ?? key,
    displayName: meta?.displayName ?? key,
    enabled: meta?.enabled ?? false,
    protocol,
    baseUrl: pi.baseUrl ?? '',
    apiKeyRef,
    apiKey,
    headers: pi.headers ?? {},
    authHeader: pi.authHeader ?? true,
    timeout: meta?.timeout ?? null,
    defaultModelId: meta?.defaultModelId ?? pi.models?.[0]?.id ?? null,
    modelCount: pi.models?.length ?? 0,
    createdAt: meta?.createdAt ?? now,
    updatedAt: meta?.updatedAt ?? now
  }
}

export function modelToDomain(
  providerKey: string,
  pi: PiModelConfig,
  providerProtocol: ProtocolId,
  meta: ModelMeta | undefined
): ModelDefinition {
  const protocol: ProtocolId = isProtocolId(pi.api ?? '')
    ? (pi.api as ProtocolId)
    : providerProtocol
  const input = resolveModelInput({
    providerKey,
    modelId: pi.id,
    configuredInput: pi.input
  })
  // Current catalog capabilities override stale local entries; custom models keep
  // their explicitly configured Pi input modes.
  const vision = input.includes('image')
  const tools = meta?.capabilities?.tools ?? true
  const reasoning = meta?.capabilities?.reasoning ?? pi.reasoning ?? false
  const streaming = meta?.capabilities?.streaming ?? true
  const now = Date.now()
  return {
    id: `${providerKey}::${pi.id}`,
    providerId: providerKey,
    modelId: pi.id,
    displayName: meta?.displayName ?? pi.name ?? pi.id,
    protocol,
    enabled: meta?.enabled ?? true,
    capabilities: {
      text: true,
      vision,
      tools,
      reasoning,
      streaming
    },
    contextWindow: pi.contextWindow ?? null,
    maxOutputTokens: pi.maxTokens ?? null,
    reasoning,
    vision,
    tools,
    streaming,
    thinkingLevels: pi.thinkingLevelMap ?? null,
    metadata: {},
    createdAt: meta?.createdAt ?? now,
    updatedAt: meta?.updatedAt ?? now
  }
}

/**
 * Pi resolves `definition.api ?? provider.api`. Models that follow the
 * provider must omit `api`, otherwise a later protocol change (or a newly
 * discovered model) stays stuck on a stale per-model copy. Only an explicit
 * per-model override keeps `api`.
 */
export function syncInheritedModelApis(
  models: PiModelConfig[] | undefined,
  providerApi: string | undefined,
  previousProviderApi?: string
): PiModelConfig[] {
  if (!models?.length) return models ?? []
  return models.map((model) => {
    if (!inheritsProviderApi(model.api, providerApi, previousProviderApi)) return model
    if (!model.api) return model
    const next = { ...model }
    delete next.api
    return next
  })
}

function inheritsProviderApi(
  modelApi: string | undefined,
  providerApi: string | undefined,
  previousProviderApi?: string
): boolean {
  if (!modelApi) return true
  return (
    modelApi === providerApi || (previousProviderApi != null && modelApi === previousProviderApi)
  )
}

export function providerProtocolFromPi(api: string | undefined): ProtocolId {
  const normalized = api ?? ''
  return isProtocolId(normalized) ? normalized : 'openai-completions'
}

export function domainProviderToPi(
  existing: PiProviderConfig | undefined,
  form: {
    protocol: ProtocolId
    baseUrl: string
    headers: Record<string, string>
    authHeader: boolean
    apiKeyValue?: string
  }
): PiProviderConfig {
  const next: PiProviderConfig = {
    ...(existing ?? {}),
    api: form.protocol,
    baseUrl: form.baseUrl || undefined,
    headers: Object.keys(form.headers).length ? form.headers : existing?.headers,
    authHeader: form.authHeader,
    models: syncInheritedModelApis(existing?.models, form.protocol, existing?.api)
  }
  if (form.apiKeyValue !== undefined) {
    if (form.apiKeyValue === '') delete next.apiKey
    else next.apiKey = form.apiKeyValue
  }
  return next
}

export function domainModelToPi(
  existing: PiModelConfig | undefined,
  form: {
    modelId: string
    displayName: string
    protocol: ProtocolId
    reasoning: boolean
    vision: boolean
    contextWindow: number | null
    maxOutputTokens: number | null
    thinkingLevels?: Partial<Record<string, string | null>>
  },
  providerProtocol: ProtocolId
): PiModelConfig {
  const input = form.vision ? (['text', 'image'] as const) : (['text'] as const)
  const next: PiModelConfig = {
    ...(existing ?? {}),
    id: form.modelId,
    name: form.displayName,
    reasoning: form.reasoning || undefined,
    input: [...input],
    contextWindow: form.contextWindow ?? undefined,
    maxTokens: form.maxOutputTokens ?? undefined,
    thinkingLevelMap: form.thinkingLevels
  }
  if (form.protocol === providerProtocol) delete next.api
  else next.api = form.protocol
  return next
}

export { maskKey, modelMetaKey }

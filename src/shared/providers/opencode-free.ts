export const OPENCODE_FREE_ID = 'opencode-free'
export const OPENCODE_BASE_URL = 'https://opencode.ai/inference/openai/v1'
export const OPENCODE_MODELS_URL = 'https://opencode.ai/inference/v1/models'
export const OPENCODE_DOCS_URL = 'https://opencode.ai/v2/docs/console/models/'
/** Zen is retained only to read legacy metadata; new configuration accepts inference only. */
export type OpenCodeAuthMode = 'inference' | 'zen'
export type OpenCodePrice = 'free' | 'paid' | 'unknown'
export type OpenCodeVerification = 'not_verified' | 'verified' | 'failed'
export interface OpenCodeModel {
  service?: 'zen' | 'go'
  id: string
  name: string
  price: OpenCodePrice
  available: boolean
  api: 'openai-completions' | null
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number } | null
  contextWindow: number | null
  maxTokens: number | null
  input: string[] | null
  reasoning: boolean | null
  streaming: OpenCodeVerification
  tools: OpenCodeVerification
  checkedAt: number | null
  status: 'not_verified' | 'ready' | 'restricted' | 'auth_required' | 'unavailable' | 'failed'
  errorCode: string | null
}
export interface OpenCodeTestOptions {
  confirmInference: true
  allowPaid?: boolean
  credentialId?: string
  expectedCost?: NonNullable<OpenCodeModel['cost']>
  expectedService?: 'zen' | 'go'
}
export interface OpenCodeCredential {
  id: string
  name: string
}
export interface OpenCodeFreeState {
  schemaVersion: 2
  enabled: boolean
  showInWorkspace?: boolean
  workspaceModelIds?: string[]
  credentials?: OpenCodeCredential[]
  activeCredentialId?: string | null
  authMode: OpenCodeAuthMode
  hasCredential: boolean
  connectionStatus: string
  httpStatus: number | null
  allowedPaidModels: string[]
  authorizedModels: string[]
  selectedModel: string | null
  refreshedAt: number | null
  error: string | null
  models: OpenCodeModel[]
}

/** Display eligibility only; Main and the native runtime independently enforce dispatch. */
export function openCodeVerificationBlock(
  state: OpenCodeFreeState | null,
  model: OpenCodeModel
): string | null {
  if (!state?.hasCredential) return 'NOT_CONFIGURED'
  if (!state.enabled) return 'PROVIDER_DISABLED'
  if (!model.available) return 'MODEL_UNAVAILABLE'
  if (model.api !== 'openai-completions') return 'PROTOCOL_NOT_VERIFIED'
  if (!model.contextWindow || !model.maxTokens || !model.input?.length)
    return 'MODEL_METADATA_UNKNOWN'
  if (!state.authorizedModels.includes(model.id)) return 'INSUFFICIENT_PERMISSION'
  if (model.price === 'unknown' || !model.cost) return 'PRICE_UNKNOWN'
  return null
}
export function openCodeSelectionBlock(
  state: OpenCodeFreeState | null,
  model: OpenCodeModel
): string | null {
  const blocked = openCodeVerificationBlock(state, model)
  if (blocked) return blocked
  if (model.status !== 'ready' || model.streaming !== 'verified' || model.tools !== 'verified')
    return model.errorCode ?? 'NOT_VERIFIED'
  if (!state?.refreshedAt || Date.now() - state.refreshedAt >= 86400000) return 'NOT_VERIFIED'
  if (model.price === 'paid' && !state.allowedPaidModels.includes(model.id))
    return 'PAID_AUTHORIZATION_REQUIRED'
  return null
}

/** Workspace visibility is an explicit preference, separate from runtime eligibility. */
export function showOpenCodeWorkspaceModel(
  state: OpenCodeFreeState | null,
  modelId: string
): boolean {
  return (
    state?.showInWorkspace === true &&
    state.hasCredential &&
    state.workspaceModelIds?.includes(modelId) === true
  )
}

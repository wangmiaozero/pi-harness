import fs from 'node:fs/promises'
import { serviceBase, ID } from './opencode-catalog.mjs'

export async function readState(file = process.env.PI_HARNESS_OPENCODE_STATE) {
  if (!file) return { enabled: false, models: [] }
  try {
    const raw = await fs.readFile(file, 'utf8')
    if (raw.length > 2 * 1024 * 1024) throw new Error('INVALID_CACHE')
    const value = JSON.parse(raw)
    if (value.schemaVersion !== 2 || !Array.isArray(value.models)) throw new Error('INVALID_CACHE')
    return value
  } catch {
    return { enabled: false, models: [] }
  }
}

export function runtimeModels(state) {
  return state.schemaVersion === 2 &&
    state.enabled &&
    state.hasCredential &&
    state.authMode === 'inference'
    ? state.models
        .filter(
          (m) =>
            (m.service === undefined || m.service === 'zen' || m.service === 'go') &&
            m.status === 'ready' &&
            m.available &&
            (m.price === 'free' ||
              (m.price === 'paid' && state.allowedPaidModels?.includes(m.id))) &&
            state.authorizedModels?.includes(m.id) &&
            Date.now() - state.refreshedAt < 24 * 60 * 60 * 1000 &&
            m.api === 'openai-completions' &&
            m.cost &&
            m.streaming === 'verified' &&
            m.tools === 'verified' &&
            m.contextWindow > 0 &&
            m.maxTokens > 0
        )
        .map((m) => ({
          id: m.id,
          name: m.name,
          provider: ID,
          api: 'openai-completions',
          baseUrl: serviceBase(m.service),
          contextWindow: m.contextWindow,
          maxTokens: m.maxTokens,
          reasoning: m.reasoning === true,
          input: m.input ?? ['text'],
          cost: m.cost
        }))
    : []
}

/** A profile id selects only this provider's OS secret namespace. Never accept a raw secret reference. */
export function credentialSlot(state) {
  const id = state.activeCredentialId === undefined ? 'default' : state.activeCredentialId
  if (id === 'default') return 'opencode-free-official'
  if (
    typeof id !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)
  )
    throw new Error('NOT_CONFIGURED')
  return `opencode-key-${id}`
}

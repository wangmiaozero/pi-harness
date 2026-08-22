/**
 * Protocol Registry.
 *
 * Pi Coding Agent's native `models.json` declares the API protocol via the
 * `api` field. Pi supports exactly four protocol values (verified against
 * the installed Pi 0.84.1 docs/docs/models.md):
 *
 *   - openai-completions   (OpenAI Chat Completions — most compatible)
 *   - openai-responses      (OpenAI Responses API)
 *   - anthropic-messages    (Anthropic Messages API)
 *   - google-generative-ai  (Google Generative AI)
 *
 * This registry is the single source of truth for how Pi-Harness presents
 * protocols and how the Pi Config Adapter serialises them. "Provider name
 * must not decide the API protocol" — the protocol is an explicit, first-class
 * choice independent of the provider.
 */

export const PROTOCOL_IDS = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
  'google-generative-ai'
] as const

export type ProtocolId = (typeof PROTOCOL_IDS)[number]

export interface ProtocolDescriptor {
  /** Stable id; identical to the value written to Pi `models.json` `api`. */
  id: ProtocolId
  /** Human-readable label shown in the protocol selector. */
  label: string
  /** What this protocol speaks. */
  description: string
  /** Typical endpoint convention, for guidance only. */
  endpointConvention: string
  /** Whether `Authorization: Bearer <key>` should be sent by default. */
  defaultAuthHeader: boolean
  /** Whether `samplingParams` are honoured by this protocol. */
  supportsSamplingParams: boolean
}

export const PROTOCOLS: readonly ProtocolDescriptor[] = [
  {
    id: 'openai-completions',
    label: 'OpenAI Chat Completions',
    description: 'OpenAI Chat Completions — the most broadly compatible protocol.',
    endpointConvention: 'POST {baseUrl}/chat/completions',
    defaultAuthHeader: true,
    supportsSamplingParams: true
  },
  {
    id: 'openai-responses',
    label: 'OpenAI Responses',
    description: 'OpenAI Responses API.',
    endpointConvention: 'POST {baseUrl}/responses',
    defaultAuthHeader: true,
    supportsSamplingParams: true
  },
  {
    id: 'anthropic-messages',
    label: 'Anthropic Messages',
    description: 'Anthropic Messages API.',
    endpointConvention: 'POST {baseUrl}/messages',
    defaultAuthHeader: true,
    supportsSamplingParams: false
  },
  {
    id: 'google-generative-ai',
    label: 'Google Generative AI',
    description: 'Google Generative AI (Gemini). A baseUrl is required for custom entries.',
    endpointConvention: 'POST {baseUrl}/models/{model}:generateContent',
    defaultAuthHeader: false,
    supportsSamplingParams: false
  }
]

export function getProtocol(id: string): ProtocolDescriptor | undefined {
  return PROTOCOLS.find((p) => p.id === id)
}

export function isProtocolId(value: string): value is ProtocolId {
  return (PROTOCOL_IDS as readonly string[]).includes(value)
}

export { PROVIDER_PRESETS } from './provider-presets'
export type { ProviderPreset, ProviderPresetModel } from './provider-presets'

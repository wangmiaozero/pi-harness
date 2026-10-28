import type { CapabilityDescriptor } from '../capabilities/types'
import { z } from 'zod'

const text = z
  .string()
  .max(4096)
  .refine((v) => !/[\0\r\n]/.test(v))
export const resourceId = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/)
  .refine((value) => !['constructor', 'prototype', '__proto__'].includes(value))
export const revisionSchema = z.string().regex(/^[a-f0-9]{64}$/)
export const scopeSchema = z.strictObject({ root: text.min(1).optional() })
export type SettingsScope = z.infer<typeof scopeSchema>
export const aiPreferencesSchema = z.strictObject({
  defaultThinkingLevel: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']),
  compactionEnabled: z.boolean(),
  reserveTokens: z.number().int().min(1024).max(131072),
  keepRecentTokens: z.number().int().min(1024).max(131072),
  retryEnabled: z.boolean(),
  maxRetries: z.number().int().min(0).max(10)
})
export type AiPreferences = z.infer<typeof aiPreferencesSchema>
export interface InstructionDocument {
  path: string
  content: string
  revision: string
}
export const instructionSaveSchema = scopeSchema.extend({
  content: z.string().max(256 * 1024),
  revision: revisionSchema
})
const references = z
  .record(
    z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
    z
      .string()
      .max(2048)
      .regex(/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/)
  )
  .refine((v) => Object.keys(v).length <= 100)
const headers = z
  .record(
    z.string().regex(/^[A-Za-z0-9-]{1,100}$/),
    z
      .string()
      .max(2048)
      .regex(/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/)
  )
  .refine((v) => Object.keys(v).length <= 100)
export const httpEndpoint = z
  .string()
  .max(2048)
  .url()
  .refine((value) => {
    const url = new URL(value)
    return (
      !url.username &&
      !url.password &&
      !url.hash &&
      !url.search &&
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    )
  }, 'Use HTTPS, or HTTP on localhost, without credentials or query parameters.')
export const mcpSaveSchema = scopeSchema
  .extend({
    id: resourceId,
    revision: revisionSchema,
    type: z.enum(['stdio', 'http']),
    command: text.max(1024).optional(),
    args: z.array(text.max(4096)).max(100).optional(),
    url: httpEndpoint.optional(),
    description: z.string().max(2000).optional(),
    enabled: z.boolean(),
    exposure: z.enum(['codemode', 'deferred', 'direct', 'hidden']),
    env: references.optional(),
    headers: headers.optional()
  })
  .refine((v) =>
    v.type === 'stdio' ? Boolean(v.command?.trim()) && !v.url : Boolean(v.url) && !v.command
  )
export type McpInput = z.infer<typeof mcpSaveSchema>
export interface McpEntry {
  capability: CapabilityDescriptor
  id: string
  type: 'stdio' | 'http'
  command: string
  args: string[]
  url: string
  description: string
  enabled: boolean
  exposure: 'codemode' | 'deferred' | 'direct' | 'hidden'
  env: Record<string, string>
  headers: Record<string, string>
  protectedFields: boolean
}
export interface McpInventory {
  path: string
  revision: string
  entries: McpEntry[]
}
export const mcpTargetSchema = scopeSchema.extend({ id: resourceId, revision: revisionSchema })
export const mcpToggleSchema = mcpTargetSchema.extend({ enabled: z.boolean() })

export const SHORTCUT_DEFAULTS = {
  'command-palette': ['meta+k', 'ctrl+k'],
  settings: ['meta+,', 'ctrl+,'],
  'workspace-new-session': ['meta+n', 'ctrl+n'],
  'workspace-close-tab': ['meta+w', 'ctrl+w']
} as const
export type ShortcutId = keyof typeof SHORTCUT_DEFAULTS
export const shortcutChord = z
  .string()
  .max(80)
  .regex(
    /^(?:(?:meta|ctrl|alt|shift)\+)+(?:[a-z0-9,./;[\]\\'`=-]|escape|enter|backspace|delete|arrowup|arrowdown|arrowleft|arrowright|f[1-9]|f1[0-2])$/
  )
export const shortcutOverridesSchema = z
  .object(
    Object.fromEntries(
      Object.keys(SHORTCUT_DEFAULTS).map((id) => [id, z.array(shortcutChord).max(2).optional()])
    )
  )
  .strict()
  .refine((value) => {
    const used = new Set<string>()
    for (const [id, defaults] of Object.entries(SHORTCUT_DEFAULTS)) {
      for (const chord of (value[id] as string[] | undefined) ?? defaults) {
        if (used.has(chord)) return false
        used.add(chord)
      }
    }
    return true
  }, 'Shortcut is already assigned.')

export const voiceSettingsSchema = z.strictObject({
  enabled: z.boolean(),
  adapter: z.enum(['openai-realtime', 'gemini-live', 'codex-live', 'doubao-realtime']).optional(),
  providerKey: resourceId.optional(),
  endpoint: httpEndpoint,
  model: text.min(1).max(128),
  voice: text.min(1).max(100),
  profile: z.enum(['realtime-ga', 'realtime-compat-v1'])
})
export type VoiceSettings = z.infer<typeof voiceSettingsSchema>
export interface VoicePublicSettings extends VoiceSettings {
  hasCredential: boolean
}
export const voicePrepareSchema = z.strictObject({
  sessionId: z.string().min(1).max(256).optional(),
  shareContext: z.boolean().default(false)
})
export type VoicePreparation = z.input<typeof voicePrepareSchema>
export interface VoiceWorkOperation {
  id: string
  sessionId: string
  instruction: string
  status: 'review' | 'sending' | 'sent' | 'rejected' | 'failed'
}
export type VoiceEvent =
  | { callId: string; kind: 'ready' | 'ended' | 'interrupted' }
  | { callId: string; kind: 'audio'; data: string }
  | { callId: string; kind: 'transcript'; role: 'user' | 'assistant'; text: string }
  | { callId: string; kind: 'error'; message: string }
  | { callId: string; kind: 'activity'; userSpeaking?: boolean; assistantSpeaking?: boolean }
  | { callId: string; kind: 'work'; operation: VoiceWorkOperation }
  | { callId: string; kind: 'signal'; message: string }
export const voiceSaveSchema = voiceSettingsSchema.extend({
  apiKey: z.string().min(1).max(8192).optional()
})
export const callIdSchema = z.strictObject({ callId: z.string().uuid() })
export const voiceStartSchema = callIdSchema.extend({
  offerSdp: z.string().min(1).max(262144).optional()
})
export const voiceSignalSchema = callIdSchema.extend({ message: z.string().min(1).max(65536) })
export const voiceReviewSchema = callIdSchema.extend({
  operationId: z.string().uuid(),
  accept: z.boolean()
})
export const voiceAudioSchema = callIdSchema.extend({
  data: z
    .string()
    .min(4)
    .max(32768)
    .regex(/^[A-Za-z0-9+/]*={0,2}$/)
})
export const voiceMuteSchema = callIdSchema.extend({ muted: z.boolean() })

export const remoteEndpoint = z
  .string()
  .max(2048)
  .url()
  .refine((value) => {
    const url = new URL(value)
    return (
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === '/v1/racp/ws' &&
      (url.protocol === 'wss:' ||
        (url.protocol === 'ws:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    )
  }, 'Use wss://host/v1/racp/ws, or ws://localhost/v1/racp/ws.')
export const remotePairSchema = z.strictObject({
  label: z.string().trim().min(1).max(100),
  url: remoteEndpoint,
  token: z
    .string()
    .min(6)
    .max(4096)
    .regex(/^(ppt1|pdt1)\.[A-Za-z0-9_.-]+$/)
})
export interface RemoteHost {
  id: string
  label: string
  url: string
  hostId: string
  version: string
  status: 'connected' | 'disconnected'
  lastConnectedAt: string | null
}
export interface RemoteSession {
  id: string
  title: string
  cwd: string
}
export interface RemoteProject {
  id: string
  name: string
  path: string
}
export interface RemoteMessage {
  role: string
  text: string
}
export const remoteApprovalSchema = z.object({
  id: z.string().min(1).max(256),
  sessionId: z.string().min(1).max(256),
  kind: z.enum(['tool', 'plan', 'goal']),
  summary: z.string().max(20000),
  expiresAt: z.string().max(100),
  revision: z.number().int().min(0),
  allowedDecisions: z
    .array(z.enum(['allow-once', 'allow-session', 'deny', 'approve', 'reject']))
    .min(1)
    .max(5),
  allowedPermissionModes: z
    .array(z.enum(['ask', 'accept-edits', 'auto']))
    .max(3)
    .optional()
})
export type RemoteApproval = z.infer<typeof remoteApprovalSchema>
export interface RemoteConversation {
  messages: RemoteMessage[]
  approvals: RemoteApproval[]
}
export const remoteApprovalResponseSchema = z.strictObject({
  id: z.string().uuid(),
  sessionId: z.string().min(1).max(256),
  approvalId: z.string().min(1).max(256),
  decision: z.enum(['allow-once', 'allow-session', 'deny', 'approve', 'reject']),
  permissionMode: z.enum(['ask', 'accept-edits', 'auto']).optional()
})
export interface AgentSettingsAPI {
  ai: { get(): Promise<AiPreferences>; set(input: AiPreferences): Promise<AiPreferences> }
  instructions: {
    read(scope: SettingsScope): Promise<InstructionDocument>
    save(input: z.infer<typeof instructionSaveSchema>): Promise<InstructionDocument>
  }
  mcp: {
    list(scope: SettingsScope): Promise<McpInventory>
    scan(scope: SettingsScope): Promise<McpScanReport>
    market(input: z.input<typeof mcpMarketQuerySchema>): Promise<McpMarketResult>
    install(input: z.infer<typeof mcpCatalogInstallSchema>): Promise<McpInventory>
    save(input: McpInput): Promise<McpInventory>
    toggle(input: z.infer<typeof mcpToggleSchema>): Promise<McpInventory>
    remove(input: z.infer<typeof mcpTargetSchema>): Promise<McpInventory>
  }
  voice: {
    get(): Promise<VoicePublicSettings>
    save(input: z.infer<typeof voiceSaveSchema>): Promise<VoicePublicSettings>
    prepare(input?: VoicePreparation): Promise<string>
    start(callId: string, offerSdp?: string): Promise<{ answerSdp: string } | void>
    signal(callId: string, message: string): Promise<void>
    review(callId: string, operationId: string, accept: boolean): Promise<void>
    stop(callId: string): Promise<void>
    audio(callId: string, data: string): Promise<void>
    mute(callId: string, muted: boolean): Promise<void>
    onEvent(listener: (event: VoiceEvent) => void): () => void
  }
  remote: {
    list(): Promise<RemoteHost[]>
    pair(input: z.infer<typeof remotePairSchema>): Promise<RemoteHost>
    connect(id: string): Promise<RemoteHost>
    disconnect(id: string): Promise<void>
    remove(id: string): Promise<void>
    projects(id: string): Promise<RemoteProject[]>
    sessions(id: string): Promise<RemoteSession[]>
    history(id: string, sessionId: string): Promise<RemoteConversation>
    approve(input: z.infer<typeof remoteApprovalResponseSchema>): Promise<void>
    prompt(id: string, sessionId: string, text: string): Promise<void>
    stop(id: string, sessionId: string): Promise<void>
    create(id: string, projectId: string): Promise<RemoteSession>
  }
}

export interface McpScanCandidate {
  key: string
  source: string
  template: import('../capabilities/mcp-catalog').McpTemplate
  warnings: string[]
  blocked: boolean
}
export interface McpScanReport {
  candidates: McpScanCandidate[]
  sources: Array<{
    name: string
    path: string
    status: 'missing' | 'read' | 'error'
    count: number
  }>
}
export interface McpMarketResult {
  entries: import('../capabilities/mcp-catalog').McpCatalogEntry[]
  nextCursor?: string
  offline: boolean
}
export const mcpMarketQuerySchema = z.strictObject({
  query: z.string().trim().max(200).default(''),
  cursor: z.string().max(1024).optional()
})
export const mcpCatalogInstallSchema = scopeSchema.extend({
  catalogId: resourceId,
  revision: revisionSchema,
  folder: text.min(1).optional()
})

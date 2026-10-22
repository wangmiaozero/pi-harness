/**
 * Universal Runtime capability negotiation contract.
 *
 * Every runtime adapter declares exactly what it natively supports. The UI
 * hides unsupported controls and the main process rejects unsupported calls —
 * a declared capability must be backed by a working implementation, and an
 * unsupported capability must never be advertised.
 */

export const RUNTIME_CAPABILITIES = [
  'session.create',
  'session.list',
  'session.resume',
  'session.close',
  'session.fork',
  'prompt.send',
  'prompt.cancel',
  'streaming',
  'thinking',
  'tool.calls',
  'model.selection',
  'model.reasoning',
  'mcp',
  'skills',
  'extensions',
  'trace',
  'replay',
  'checkpoint',
  'recovery',
  'multiAgent',
  'worktree',
  'permission.requests',
  'images'
] as const

export type RuntimeCapability = (typeof RUNTIME_CAPABILITIES)[number]

export interface RuntimeCapabilities {
  /** Capabilities the runtime natively implements and verifies. */
  supported: readonly RuntimeCapability[]
}

export const EMPTY_RUNTIME_CAPABILITIES: RuntimeCapabilities = { supported: [] }

export function supportsCapability(
  capabilities: RuntimeCapabilities,
  capability: RuntimeCapability
): boolean {
  return capabilities.supported.includes(capability)
}

/** Assert the runtime supports a capability before dispatching a call. */
export class CapabilityNotSupportedError extends Error {
  constructor(
    readonly runtimeId: string,
    readonly capability: RuntimeCapability
  ) {
    super(`Runtime "${runtimeId}" does not support: ${capability}`)
    this.name = 'CapabilityNotSupportedError'
  }
}

export function assertCapability(
  runtimeId: string,
  capabilities: RuntimeCapabilities,
  capability: RuntimeCapability
): void {
  if (!supportsCapability(capabilities, capability)) {
    throw new CapabilityNotSupportedError(runtimeId, capability)
  }
}

/** Stable capability catalog used by renderer UI to degrade gracefully. */
export const RUNTIME_CAPABILITY_LABELS: Record<RuntimeCapability, string> = {
  'session.create': 'session.create',
  'session.list': 'session.list',
  'session.resume': 'session.resume',
  'session.close': 'session.close',
  'session.fork': 'session.fork',
  'prompt.send': 'prompt.send',
  'prompt.cancel': 'prompt.cancel',
  streaming: 'streaming',
  thinking: 'thinking',
  'tool.calls': 'tool.calls',
  'model.selection': 'model.selection',
  'model.reasoning': 'model.reasoning',
  mcp: 'mcp',
  skills: 'skills',
  extensions: 'extensions',
  trace: 'trace',
  replay: 'replay',
  checkpoint: 'checkpoint',
  recovery: 'recovery',
  multiAgent: 'multiAgent',
  worktree: 'worktree',
  'permission.requests': 'permission.requests',
  images: 'images'
}

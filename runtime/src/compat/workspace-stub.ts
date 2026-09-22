/**
 * Stand-in types for Electron-only modules that the ported diagnostics
 * service imports. The sidecar wires a thin adapter instead of bringing
 * the Electron SessionService / AgentRuntime implementations across.
 */

export type SessionService = {
  sessionsRoot(): string
  list(): Promise<Array<{ id?: string }>>
}

export type AgentRuntime = {
  diagnostics(): { implementation: 'pi'; sdkLoaded: boolean }
  listRunning(): string[]
}

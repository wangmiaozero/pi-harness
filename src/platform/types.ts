/**
 * Platform layer types.
 *
 * The platform layer re-implements the exact `PiSwitchAPI` contract that the
 * Electron preload bridge installs on `window.piSwitch`. The renderer never
 * knows which desktop host it is running on.
 *
 * Types in this file must stay structurally compatible with
 * `@shared/ipc/api-types` — they intentionally re-use those declarations
 * wherever possible rather than duplicating them.
 */

import type { PiSwitchAPI, SystemInfo } from '@shared/ipc/api-types'
import type { AppErrorPayload } from '@shared/types/errors'

/** Runtime supervisor phases, mirrored from Rust `RuntimePhase.as_str()`. */
export type RuntimePhase = 'stopped' | 'starting' | 'running' | 'stopping' | 'crashed'

/** Snapshot returned by the Rust `runtime_status` command (camelCase JSON). */
export interface RuntimeStatus {
  phase: RuntimePhase
  pid?: number
  exitCode?: number
  runtimeVersion?: string
  protocolVersion?: number
  nodeVersion?: string
  error?: string
}

export interface RuntimeVersionResult {
  runtimeVersion: string
  protocolVersion: number
  nodeVersion: string
}

export interface RuntimePingResult {
  pong: boolean
  timestamp: number
}

/** Event payloads for the runtime lifecycle events. */
export interface RuntimeStateEvent {
  phase: RuntimePhase
}

export interface RuntimeRuntimeEvent {
  event: string
  payload: unknown
}

export interface RuntimeLogEvent {
  line: string
}

/**
 * Tauri-only extension to the `window.piSwitch` surface: direct control of
 * the Node.js runtime sidecar. Not part of `PiSwitchAPI` (the Electron
 * preload keeps its exact shape); exposed as `window.piSwitch.runtime`.
 */
export interface PlatformRuntimeApi {
  ping(): Promise<RuntimePingResult>
  version(): Promise<RuntimeVersionResult>
  status(): Promise<RuntimeStatus>
  start(): Promise<RuntimeStatus>
  stop(): Promise<RuntimeStatus>
  restart(): Promise<RuntimeStatus>
  onState(listener: (payload: RuntimeStateEvent) => void): () => void
  onEvent(listener: (payload: RuntimeRuntimeEvent) => void): () => void
  onLog(listener: (payload: RuntimeLogEvent) => void): () => void
}

/**
 * The concrete `window.piSwitch` shape under Tauri: the full Electron
 * contract plus the runtime extension namespace.
 */
export type PiSwitchTauriAPI = PiSwitchAPI & { runtime: PlatformRuntimeApi }

export type { SystemInfo, AppErrorPayload }

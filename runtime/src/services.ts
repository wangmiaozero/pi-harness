/**
 * Runtime service composition root.
 *
 * Wires SessionService + AgentRuntimeManager + HarnessService together and
 * exposes the single `RuntimeServices` bundle consumed by the RPC dispatcher.
 * `index.ts` provides the event sinks that forward to the JSONL stdout
 * writer; tests provide recording sinks instead.
 */

import type { AgentEventBatch } from './agent/events.js'
import { AgentRuntimeManager } from './agent/manager.js'
import { HarnessService } from './harness/service.js'
import type { HarnessEvent } from './harness/types.js'
import type { PiSdkLoader } from './pi/types.js'
import { defaultPiSdkLoader } from './pi/sdk.js'
import { SessionService, type LogFn } from './session/service.js'

export interface RuntimeServiceDeps {
  /** SDK module loader — injected in tests, lazily default in production. */
  loadSdk?: PiSdkLoader
  /** Diagnostic log (stderr in production). */
  log?: LogFn
  /** `agent.event` envelope sink — index.ts routes this to stdout. */
  onAgentEvent?: (batch: AgentEventBatch) => void
  /** `agent.running` sink — index.ts routes this to stdout. */
  onRunningChange?: (ids: string[]) => void
  /** `harness.event` sink — index.ts routes this to stdout.
   * Harness events are pushed immediately (they are low volume and must not
   * be reordered against the agent event stream). */
  onHarnessEvent?: (sessionId: string, event: HarnessEvent) => void
}

export interface RuntimeServices {
  sessions: SessionService
  agent: AgentRuntimeManager
  harness: HarnessService
  /** Stop all live agent sessions (flushes the event batcher). */
  shutdown(): Promise<void>
}

export function createRuntimeServices(deps: RuntimeServiceDeps = {}): RuntimeServices {
  const loadSdk = deps.loadSdk ?? defaultPiSdkLoader
  const log: LogFn = deps.log ?? (() => {})
  const sessions = new SessionService(loadSdk, log)
  const agent = new AgentRuntimeManager(
    sessions,
    loadSdk,
    {
      onAgentEvent: deps.onAgentEvent ?? (() => {}),
      onRunningChange: deps.onRunningChange ?? (() => {})
    },
    log
  )
  const harness = new HarnessService(
    agent,
    sessions,
    { onEvent: deps.onHarnessEvent ?? (() => {}) },
    log
  )
  return {
    sessions,
    agent,
    harness,
    async shutdown(): Promise<void> {
      await harness.shutdownAll()
    }
  }
}

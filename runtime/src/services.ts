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
import type { HarnessEvent as ControlPlaneEvent } from './harness-control/types.js'
import { ControlPlaneService } from './harness-control/service.js'
import { createOrchestrator } from './orchestration/host.js'
import type { OrchestratorService } from './orchestration/service.js'
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
  control: ControlPlaneService
  orchestration: OrchestratorService
  /** Stop all live agent sessions (flushes the event batcher). */
  shutdown(): Promise<void>
}

export function createRuntimeServices(deps: RuntimeServiceDeps = {}): RuntimeServices {
  const loadSdk = deps.loadSdk ?? defaultPiSdkLoader
  const log: LogFn = deps.log ?? (() => {})
  const sessions = new SessionService(loadSdk, log)

  const controlRef: { current?: ControlPlaneService } = {}
  const agent = new AgentRuntimeManager(
    sessions,
    loadSdk,
    {
      onAgentEvent: deps.onAgentEvent ?? (() => {}),
      onRunningChange: deps.onRunningChange ?? (() => {}),
      onSessionCreated: (session, sessionId) =>
        controlRef.current?.wrapSessionTools(session, sessionId)
    },
    log
  )
  const harness = new HarnessService(
    agent,
    sessions,
    {
      onEvent: (sessionId, event) => {
        controlRef.current?.observe(sessionId, event as ControlPlaneEvent)
        deps.onHarnessEvent?.(sessionId, event)
      }
    },
    log
  )
  const control = new ControlPlaneService({ harness, sessions, agent })
  controlRef.current = control
  const orchestration = createOrchestrator(harness, control, sessions)
  orchestration.attach()
  void orchestration.recoverAll().catch((error) => {
    log(
      `orchestration recovery failed: ${error instanceof Error ? error.message : String(error)}`
    )
  })
  return {
    sessions,
    agent,
    harness,
    control,
    orchestration,
    async shutdown(): Promise<void> {
      orchestration.detach()
      await harness.shutdownAll()
    }
  }
}

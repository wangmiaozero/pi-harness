/**
 * Orchestrator host adapter for the Node runtime sidecar.
 *
 * Bridges OrchestratorService onto ControlPlane + Harness + Session.
 * Worktree creation is best-effort: Phase 3 does not migrate Git Worktree,
 * so isolated agents fall back to the shared orchestration cwd.
 */

import { JsonStore } from '../support/json-store.js'
import { harnessOrchestrationPath } from '../harness-control/paths.js'
import type { ControlPlaneService } from '../harness-control/service.js'
import type { HarnessService } from '../harness/service.js'
import type { SessionService } from '../session/service.js'
import type { RunRelationAnnotation } from '../harness-control/runs/run-registry.js'
import type { HarnessEvent } from '../harness-control/types.js'
import type { StartAgentSessionInput } from '../types.js'
import {
  EMPTY_ORCHESTRATION_STORE,
  OrchestrationStore,
  type OrchestrationStoreRecord
} from './store.js'
import { OrchestratorService, type OrchestratorHost } from './service.js'

export function createOrchestratorHost(
  harness: HarnessService,
  control: ControlPlaneService,
  sessions: SessionService
): OrchestratorHost {
  return {
    async startSession(input: StartAgentSessionInput) {
      return harness.start(input)
    },
    async prompt(sessionId: string, message: string) {
      return harness.prompt(sessionId, message)
    },
    async abortSession(sessionId: string) {
      await harness.abort(sessionId)
    },
    annotateNextRun(sessionId: string, annotation: RunRelationAnnotation) {
      control.annotateNextRun(sessionId, annotation)
    },
    async setSessionName(sessionId: string, name: string) {
      await sessions.rename(sessionId, name)
    },
    emitOrchestrationEvent(orchestrationId: string, event: HarnessEvent) {
      harness.emitEvent(orchestrationId, event)
    },
    getOrchestrationTimeline(orchestrationId: string) {
      return harness.getTimeline(orchestrationId) as HarnessEvent[]
    },
    subscribe(listener) {
      return control.onEvent(listener)
    },
    async getRunById(runId: string) {
      return control.getRunById(runId)
    },
    async listRunsByOrchestration(orchestrationId: string) {
      return control.listRunsByOrchestration(orchestrationId)
    },
    async getArtifact(artifactId: string) {
      return control.artifacts.getArtifact(artifactId)
    },
    async artifactsForTask(taskId: string) {
      return control.artifacts.listByTask(taskId)
    },
    async artifactsForAgent(agentId: string) {
      return control.artifacts.listByAgent(agentId)
    },
    async markArtifactsConsumed(artifactIds: string[], agentId: string, taskId: string | null) {
      await control.artifacts.markConsumed(artifactIds, agentId, taskId)
    },
    async bindAgentSession(_sessionId: string, _cwd: string) {
      // Workspace binding is a desktop-host concern; the sidecar already
      // starts the Pi session with the agent cwd.
    },
    async createWorktree(cwd: string, _branch: string) {
      // Git worktree UI/service is the next phase. Shared cwd is the
      // compatible fallback — agents still run real Pi sessions.
      return { path: cwd, branch: _branch }
    }
  }
}

export function createOrchestrator(
  harness: HarnessService,
  control: ControlPlaneService,
  sessions: SessionService
): OrchestratorService {
  const store = new OrchestrationStore(
    new JsonStore<OrchestrationStoreRecord>(
      harnessOrchestrationPath(),
      EMPTY_ORCHESTRATION_STORE
    )
  )
  return new OrchestratorService(store, createOrchestratorHost(harness, control, sessions))
}

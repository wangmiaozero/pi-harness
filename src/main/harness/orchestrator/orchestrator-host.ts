/**
 * Orchestrator Host — the runtime adapter for Multi-Agent Orchestration.
 *
 * Bridges OrchestratorService onto the real HarnessRuntime, workspace and git
 * services. Everything here goes through existing production seams: Pi
 * sessions, the run registry, artifact tracking, workspace binding and git
 * worktrees — no parallel infrastructure.
 */

import type { HarnessEvent } from '@shared/types/harness'
import type { StartAgentSessionInput } from '@shared/types/workspace'
import type { HarnessRuntime } from '../harness-runtime'
import type { WorkspaceService } from '../../workspace/workspace-service'
import type { WorktreeService } from '../../git/worktree-service'
import type { RunRelationAnnotation } from '../runs/run-registry'
import type { OrchestratorHost, OrchestratorService } from './orchestrator-service'
import { JsonStore } from '../../services/storage'
import { harnessOrchestrationPath } from '../../services/app-paths'
import {
  EMPTY_ORCHESTRATION_STORE,
  OrchestrationStore,
  type OrchestrationStoreRecord
} from './orchestration-store'
import { OrchestratorService as Service } from './orchestrator-service'

export function createOrchestratorHost(
  harness: HarnessRuntime,
  workspace: WorkspaceService,
  worktrees: WorktreeService
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
      harness.runs.annotateNextRun(sessionId, annotation)
    },
    async setSessionName(sessionId: string, name: string) {
      await harness.command(sessionId, { type: 'set_session_name', name })
    },
    emitOrchestrationEvent(orchestrationId: string, event: HarnessEvent) {
      harness.emitOrchestration(orchestrationId, event)
    },
    getOrchestrationTimeline(orchestrationId: string) {
      return harness.getTimeline(orchestrationId)
    },
    subscribe(listener) {
      return harness.onEvent(listener)
    },
    async getRunById(runId: string) {
      return harness.getRunById(runId)
    },
    async listRunsByOrchestration(orchestrationId: string) {
      return harness.listRunsByOrchestration(orchestrationId)
    },
    async getArtifact(artifactId: string) {
      return harness.artifacts.getArtifact(artifactId)
    },
    async artifactsForTask(taskId: string) {
      return harness.artifacts.listByTask(taskId)
    },
    async artifactsForAgent(agentId: string) {
      return harness.artifacts.listByAgent(agentId)
    },
    async markArtifactsConsumed(artifactIds: string[], agentId: string, taskId: string | null) {
      await harness.artifacts.markConsumed(artifactIds, agentId, taskId)
    },
    async bindAgentSession(sessionId: string, cwd: string) {
      await workspace.bindSession(sessionId, {
        workspaceId: `agent:${agentIdFromSession(sessionId)}`,
        mainFolderId: 'agent-workspace',
        folders: [
          {
            id: 'agent-workspace',
            path: cwd,
            role: 'main',
            readonly: false
          }
        ]
      })
    },
    async createWorktree(cwd: string, branch: string) {
      return worktrees.create(cwd, branch)
    }
  }
}

function agentIdFromSession(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 24)
}

export function createOrchestrator(
  harness: HarnessRuntime,
  workspace: WorkspaceService,
  worktrees: WorktreeService
): OrchestratorService {
  const store = new OrchestrationStore(
    new JsonStore<OrchestrationStoreRecord>(
      harnessOrchestrationPath(),
      EMPTY_ORCHESTRATION_STORE
    )
  )
  return new Service(store, createOrchestratorHost(harness, workspace, worktrees))
}

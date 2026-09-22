/**
 * Handoff Service.
 *
 * Tracks what passed between agents: explicit artifact handoffs plus the
 * dependency-driven context flow the orchestrator constructs. Consumption is
 * recorded back onto the artifacts, so "who received what" is answerable.
 */

import type {
  AgentHandoff,
  HarnessArtifact,
  HarnessEvent
} from '../harness-control/types.js'
import { newHandoffId, type OrchestrationStore } from './store.js'

export interface HandoffHooks {
  /** Mark artifacts as consumed by an agent / task. */
  markConsumed: (artifactIds: string[], agentId: string, taskId: string | null) => Promise<void>
  emit: (orchestrationId: string | null, event: HarnessEvent) => void
}

export class HandoffService {
  constructor(
    private readonly store: OrchestrationStore,
    private readonly hooks: HandoffHooks
  ) {}

  async list(orchestrationId?: string): Promise<AgentHandoff[]> {
    return this.store.listHandoffs(orchestrationId)
  }

  /**
   * Record a handoff from one agent to another over a set of artifacts.
   * Called when a dependent task starts consuming upstream artifacts.
   */
  async record(input: {
    orchestrationId: string | null
    fromAgentId: string
    toAgentId: string
    taskId: string | null
    artifactIds: string[]
    summary?: string | null
  }): Promise<AgentHandoff> {
    const handoff: AgentHandoff = {
      id: newHandoffId(),
      orchestrationId: input.orchestrationId,
      fromAgentId: input.fromAgentId,
      toAgentId: input.toAgentId,
      taskId: input.taskId,
      artifactIds: [...input.artifactIds],
      summary: input.summary ?? null,
      createdAt: Date.now()
    }
    await this.store.saveHandoff(handoff)
    if (handoff.artifactIds.length) {
      await this.hooks.markConsumed(handoff.artifactIds, input.toAgentId, input.taskId)
    }
    this.hooks.emit(handoff.orchestrationId, {
      type: 'handoff.created',
      timestamp: Date.now(),
      handoffId: handoff.id,
      fromAgentId: handoff.fromAgentId,
      toAgentId: handoff.toAgentId
    })
    return handoff
  }

  /** Resolve which upstream agents produced the artifacts a task consumes. */
  async upstreamProducers(
    artifacts: readonly HarnessArtifact[]
  ): Promise<Map<string, string>> {
    const producers = new Map<string, string>()
    for (const artifact of artifacts) {
      if (artifact.producedByAgentId) producers.set(artifact.id, artifact.producedByAgentId)
    }
    return producers
  }
}

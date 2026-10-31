/**
 * Pet event bridge — turns the agent runtime's event stream into normalized
 * PetEvents and pushes them to the pet window through the controller.
 *
 * Reuses the shared `adaptAgentEventToPetEvents` reducer (the same one that
 * powers the in-app mascot) so the desktop pet and the in-app mascot agree
 * on state transitions. Event volume is throttled upstream by the runtime;
 * per-window coalescing lives in the controller's pushState.
 */

import type { AgentEvent } from '@shared/types/workspace'
import { adaptAgentEventToPetEvents } from '@shared/pet/runtime-adapter'
import type { PetEvent } from '@shared/pet/types'
import { log } from '../services/logger'
import type { PetWindowController } from './pet-window'

/** Minimal surface of AgentRuntimeService the bridge depends on. */
export interface PetEventAgentSource {
  onEvent(listener: (event: AgentEvent) => void): () => void
  listRunning(): string[]
}

export class PetEventBridge {
  private detach: (() => void) | null = null
  private source: PetEventAgentSource | null = null

  constructor(
    private readonly controller: PetWindowController,
    private readonly getAgentSyncEnabled: () => boolean
  ) {}

  attach(agent: PetEventAgentSource): void {
    if (this.source === agent && this.detach) return
    this.dispose()
    this.detach = agent.onEvent((event) => this.handleAgentEvent(event, agent))
    this.source = agent
    log.pet.info('pet event bridge attached')
  }

  dispose(): void {
    const detach = this.detach
    this.detach = null
    this.source = null
    detach?.()
  }

  private handleAgentEvent(event: AgentEvent, agent: PetEventAgentSource): void {
    if (!this.controller.isVisible()) return
    let petEvents: PetEvent[]
    try {
      petEvents = this.getAgentSyncEnabled() ? adaptAgentEventToPetEvents(event) : []
    } catch (error) {
      log.pet.error('failed to adapt agent event for pet:', error)
      return
    }
    let activeAgents = 0
    try {
      activeAgents = agent.listRunning().length
    } catch {
      // listRunning is best-effort; the pet still gets the event stream.
    }
    this.controller.pushState(petEvents, activeAgents)
  }
}

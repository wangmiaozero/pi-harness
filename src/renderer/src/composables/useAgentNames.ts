import { ref } from 'vue'
import type { HarnessAgent } from '@shared/types/harness'
import { getApi } from '@renderer/composables/useApi'

/**
 * Agent-name resolution for run attribution. Orchestration agents live in
 * their own store; run lists only reference agent ids, so panels resolve
 * names through one shared, module-level cache.
 */
const agentsById = ref(new Map<string, HarnessAgent>())
let loaded = false
let pending: Promise<void> | null = null

async function refreshAgents(): Promise<void> {
  if (pending) return pending
  pending = (async () => {
    try {
      const agents = await getApi().orchestration.listAgents()
      agentsById.value = new Map(agents.map((agent) => [agent.id, agent]))
      loaded = true
    } catch {
      // Attribution is best-effort context; run items stay valid without it.
    } finally {
      pending = null
    }
  })()
  return pending
}

function ensureLoaded(): void {
  if (!loaded) void refreshAgents()
}

export function useAgentNames() {
  return {
    agentsById,
    agentName(agentId: string | null | undefined): string | null {
      if (!agentId) return null
      ensureLoaded()
      return agentsById.value.get(agentId)?.name ?? null
    },
    /** Re-resolve when runs reference agents the cache has not seen. */
    hasUnknownAgent(agents: { agentId: string | null }[]): boolean {
      ensureLoaded()
      return agents.some((item) => !!item.agentId && !agentsById.value.has(item.agentId))
    },
    refreshAgents
  }
}

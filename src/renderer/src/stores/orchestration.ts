import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import type {
  AgentHandoff,
  AgentTemplate,
  HarnessAgent,
  HarnessAgentBudget,
  HarnessEvent,
  HarnessEventEnvelope,
  HarnessOrchestrationRun,
  HarnessOrchestrationSnapshot,
  HarnessOrchestrationStrategy,
  HarnessTask,
  HarnessTaskPriority,
  HarnessTeam
} from '@shared/types/harness'
import { callApi, getApi } from '@renderer/composables/useApi'

export interface OrchestrationDraft {
  name: string
  cwd: string
  strategy: HarnessOrchestrationStrategy
  teamId: string | null
  maxConcurrentAgents: number
  maxConcurrentRuns: number
  budgetMaxTokens: number | null
  budgetMaxCost: number | null
}

export const useOrchestrationStore = defineStore('orchestration', () => {
  const orchestrations = shallowRef<HarnessOrchestrationRun[]>([])
  const templates = shallowRef<AgentTemplate[]>([])
  const teams = shallowRef<HarnessTeam[]>([])
  const currentId = ref<string | null>(null)
  const agents = shallowRef<HarnessAgent[]>([])
  const tasks = shallowRef<HarnessTask[]>([])
  const handoffs = shallowRef<AgentHandoff[]>([])
  const snapshot = shallowRef<HarnessOrchestrationSnapshot | null>(null)
  const loading = ref(false)
  const mutating = ref(false)
  const error = ref<string | null>(null)
  let generation = 0
  let snapshotTimer: ReturnType<typeof setTimeout> | null = null
  let unsubscribe: (() => void) | null = null

  const current = computed<HarnessOrchestrationRun | null>(
    () => orchestrations.value.find((item) => item.id === currentId.value) ?? null
  )

  function scheduleSnapshotRefresh(): void {
    if (snapshotTimer) clearTimeout(snapshotTimer)
    snapshotTimer = setTimeout(() => {
      snapshotTimer = null
      void refreshSnapshot()
      void refreshList()
    }, 250)
  }

  function setupListeners(): () => void {
    unsubscribe?.()
    unsubscribe = getApi().on('harness-event', (payload) => {
      const envelope = payload as Partial<HarnessEventEnvelope>
      const event = envelope?.event as HarnessEvent | undefined
      if (!event) return
      if (!event.type.startsWith('orchestration.') && !event.type.startsWith('task.')) return
      scheduleSnapshotRefresh()
    })
    return () => {
      unsubscribe?.()
      unsubscribe = null
    }
  }

  async function refreshList(): Promise<void> {
    const currentGeneration = ++generation
    try {
      const next = await callApi(() => getApi().orchestration.list())
      if (currentGeneration !== generation) return
      orchestrations.value = next
      if (currentId.value && !next.some((item) => item.id === currentId.value)) {
        // The selected orchestration was deleted elsewhere — fall back.
        currentId.value = next[0]?.id ?? null
      }
    } catch {
      /* list is best-effort */
    }
  }

  async function refreshPresets(): Promise<void> {
    try {
      const [nextTemplates, nextTeams] = await Promise.all([
        callApi(() => getApi().orchestration.listTemplates()),
        callApi(() => getApi().orchestration.listTeams())
      ])
      templates.value = nextTemplates
      teams.value = nextTeams
    } catch {
      /* presets degrade silently */
    }
  }

  async function select(orchestrationId: string | null): Promise<void> {
    currentId.value = orchestrationId
    snapshot.value = null
    agents.value = []
    tasks.value = []
    handoffs.value = []
    await refreshSnapshot()
  }

  async function refreshSnapshot(): Promise<void> {
    const id = currentId.value
    if (!id) return
    const currentGeneration = generation
    try {
      const next = await callApi(() => getApi().orchestration.snapshot(id))
      if (currentGeneration !== generation || currentId.value !== id) return
      snapshot.value = next
      agents.value = next.agents.map((item) => item.agent)
      tasks.value = next.tasks
      handoffs.value = next.handoffs
      error.value = null
    } catch (cause) {
      if (currentGeneration === generation) error.value = errorMessage(cause)
    }
  }

  async function load(): Promise<void> {
    loading.value = true
    try {
      await refreshList()
      if (!currentId.value) currentId.value = orchestrations.value[0]?.id ?? null
      await Promise.all([refreshPresets(), refreshSnapshot()])
    } finally {
      loading.value = false
    }
  }

  // ---------------------------------------------------------- orchestration

  async function createOrchestration(draft: OrchestrationDraft): Promise<HarnessOrchestrationRun> {
    mutating.value = true
    try {
      const created = await callApi(() =>
        getApi().orchestration.create({
          name: draft.name.trim() || undefined,
          cwd: draft.cwd,
          strategy: draft.strategy,
          teamId: draft.teamId,
          maxConcurrentAgents: draft.maxConcurrentAgents,
          maxConcurrentRuns: draft.maxConcurrentRuns,
          budget: {
            maxTokens: draft.budgetMaxTokens,
            maxCost: draft.budgetMaxCost
          }
        })
      )
      orchestrations.value = [created, ...orchestrations.value]
      currentId.value = created.id
      await refreshSnapshot()
      return created
    } finally {
      mutating.value = false
    }
  }

  async function deleteOrchestration(orchestrationId: string): Promise<void> {
    mutating.value = true
    try {
      await callApi(() => getApi().orchestration.delete(orchestrationId))
      orchestrations.value = orchestrations.value.filter((item) => item.id !== orchestrationId)
      if (currentId.value === orchestrationId) {
        currentId.value = orchestrations.value[0]?.id ?? null
        await refreshSnapshot()
      }
    } finally {
      mutating.value = false
    }
  }

  async function start(): Promise<void> {
    const id = currentId.value
    if (!id) return
    mutating.value = true
    try {
      await callApi(() => getApi().orchestration.start(id))
    } finally {
      mutating.value = false
    }
    await refreshSnapshot()
    await refreshList()
  }

  async function pause(reason?: string): Promise<void> {
    const id = currentId.value
    if (!id) return
    mutating.value = true
    try {
      await callApi(() => getApi().orchestration.pause(id, reason))
    } finally {
      mutating.value = false
    }
    await refreshSnapshot()
    await refreshList()
  }

  async function resume(): Promise<void> {
    const id = currentId.value
    if (!id) return
    mutating.value = true
    try {
      await callApi(() => getApi().orchestration.resume(id))
    } finally {
      mutating.value = false
    }
    await refreshSnapshot()
    await refreshList()
  }

  async function abort(): Promise<void> {
    const id = currentId.value
    if (!id) return
    mutating.value = true
    try {
      await callApi(() => getApi().orchestration.abort(id))
    } finally {
      mutating.value = false
    }
    await refreshSnapshot()
    await refreshList()
  }

  // ---------------------------------------------------------------- agents

  async function addAgent(input: {
    name: string
    role: string
    description?: string | null
    provider?: string | null
    modelId?: string | null
    thinkingLevel?: string | null
    toolNames?: string[] | null
    skillIds?: string[]
    workspaceMode?: 'shared' | 'worktree'
    isReviewer?: boolean
    templateId?: string | null
    budget?: HarnessAgentBudget
  }): Promise<void> {
    const id = currentId.value
    if (!id) throw new Error('No orchestration selected')
    mutating.value = true
    try {
      await callApi(() => getApi().orchestration.addAgent({ orchestrationId: id, ...input }))
    } finally {
      mutating.value = false
    }
    await refreshSnapshot()
  }

  async function updateAgent(
    agentId: string,
    patch: {
      name?: string
      description?: string | null
      provider?: string | null
      modelId?: string | null
      thinkingLevel?: string | null
      toolNames?: string[] | null
      budget?: HarnessAgentBudget
    }
  ): Promise<void> {
    mutating.value = true
    try {
      await callApi(() => getApi().orchestration.updateAgent({ agentId, ...patch }))
    } finally {
      mutating.value = false
    }
    await refreshSnapshot()
  }

  async function deleteAgent(agentId: string): Promise<void> {
    mutating.value = true
    try {
      await callApi(() => getApi().orchestration.deleteAgent(agentId))
    } finally {
      mutating.value = false
    }
    await refreshSnapshot()
  }

  async function setAgentBudget(agentId: string, budget: HarnessAgentBudget): Promise<void> {
    mutating.value = true
    try {
      await callApi(() => getApi().orchestration.setAgentBudget(agentId, budget))
    } finally {
      mutating.value = false
    }
    await refreshSnapshot()
  }

  // ----------------------------------------------------------------- tasks

  async function createTask(input: {
    title: string
    description?: string | null
    priority?: HarnessTaskPriority
    assignedAgentId?: string | null
    dependencies?: string[]
    reviewRequired?: boolean
  }): Promise<void> {
    const id = currentId.value
    if (!id) throw new Error('No orchestration selected')
    mutating.value = true
    try {
      await callApi(() => getApi().orchestration.createTask({ orchestrationId: id, ...input }))
    } finally {
      mutating.value = false
    }
    await refreshSnapshot()
  }

  async function updateTask(
    taskId: string,
    patch: {
      title?: string
      description?: string | null
      priority?: HarnessTaskPriority
      assignedAgentId?: string | null
      dependencies?: string[]
      reviewRequired?: boolean
    }
  ): Promise<void> {
    mutating.value = true
    try {
      await callApi(() => getApi().orchestration.updateTask({ taskId, ...patch }))
    } finally {
      mutating.value = false
    }
    await refreshSnapshot()
  }

  async function deleteTask(taskId: string): Promise<void> {
    mutating.value = true
    try {
      await callApi(() => getApi().orchestration.deleteTask(taskId))
    } finally {
      mutating.value = false
    }
    await refreshSnapshot()
  }

  async function retryTask(taskId: string, agentId?: string | null): Promise<void> {
    mutating.value = true
    try {
      await callApi(() => getApi().orchestration.retryTask(taskId, agentId))
    } finally {
      mutating.value = false
    }
    await refreshSnapshot()
    await refreshList()
  }

  async function skipTask(taskId: string): Promise<void> {
    mutating.value = true
    try {
      await callApi(() => getApi().orchestration.skipTask(taskId))
    } finally {
      mutating.value = false
    }
    await refreshSnapshot()
    await refreshList()
  }

  async function reassignTask(taskId: string, agentId: string): Promise<void> {
    mutating.value = true
    try {
      await callApi(() => getApi().orchestration.reassignTask(taskId, agentId))
    } finally {
      mutating.value = false
    }
    await refreshSnapshot()
  }

  return {
    orchestrations,
    templates,
    teams,
    currentId,
    current,
    agents,
    tasks,
    handoffs,
    snapshot,
    loading,
    mutating,
    error,
    setupListeners,
    load,
    select,
    refreshList,
    refreshPresets,
    refreshSnapshot,
    createOrchestration,
    deleteOrchestration,
    start,
    pause,
    resume,
    abort,
    addAgent,
    updateAgent,
    deleteAgent,
    setAgentBudget,
    createTask,
    updateTask,
    deleteTask,
    retryTask,
    skipTask,
    reassignTask
  }
})

function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const payload = error as { userMessage?: unknown; message?: unknown }
    if (typeof payload.userMessage === 'string') return payload.userMessage
    if (typeof payload.message === 'string') return payload.message
  }
  return String(error)
}

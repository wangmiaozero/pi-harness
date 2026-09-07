import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import type {
  HarnessCheckpoint,
  HarnessCompactionResult,
  HarnessEvent,
  HarnessEventEnvelope,
  HarnessEvaluation,
  HarnessForkResult,
  HarnessPolicyConfig,
  HarnessPolicySnapshot,
  HarnessRun,
  HarnessSessionInfo,
  HarnessState,
  HarnessStats,
  HarnessTool
} from '@shared/types/harness'
import { callApi, getApi } from '@renderer/composables/useApi'

export const useHarnessStore = defineStore('harness', () => {
  const sessionId = ref<string | null>(null)
  const state = shallowRef<HarnessState | null>(null)
  const session = shallowRef<HarnessSessionInfo | null>(null)
  const tools = shallowRef<HarnessTool[]>([])
  const stats = shallowRef<HarnessStats | null>(null)
  const timeline = shallowRef<HarnessEvent[]>([])
  const runs = shallowRef<HarnessRun[]>([])
  const currentRunId = ref<string | null>(null)
  const checkpoints = shallowRef<HarnessCheckpoint[]>([])
  const evaluations = shallowRef<HarnessEvaluation[]>([])
  const policy = shallowRef<HarnessPolicySnapshot | null>(null)
  const loading = ref(false)
  const mutating = ref(false)
  const error = ref<string | null>(null)
  let generation = 0
  let refreshTimer: ReturnType<typeof setTimeout> | null = null
  let runsRefreshTimer: ReturnType<typeof setTimeout> | null = null
  let unsubscribe: (() => void) | null = null

  const currentRun = computed<HarnessRun | null>(
    () => runs.value.find((run) => run.id === currentRunId.value) ?? null
  )
  const activeRun = computed<HarnessRun | null>(
    () =>
      runs.value.find((run) =>
        ['queued', 'running', 'waiting', 'tool-calling', 'verifying'].includes(run.status)
      ) ?? null
  )

  function setupListeners(): () => void {
    unsubscribe?.()
    unsubscribe = getApi().on('harness-event', (payload) => {
      const envelope = payload as Partial<HarnessEventEnvelope>
      if (!envelope.sessionId || !envelope.event || envelope.sessionId !== sessionId.value) return
      timeline.value = [...timeline.value, envelope.event].slice(-300)
      if (
        envelope.event.type.startsWith('run.') ||
        envelope.event.type.startsWith('budget.') ||
        envelope.event.type.startsWith('evaluation.')
      ) {
        scheduleRunsRefresh()
      }
      if (envelope.event.type === 'checkpoint.created') void refreshCheckpoints()
      scheduleRefresh()
    })
    return () => {
      unsubscribe?.()
      unsubscribe = null
    }
  }

  async function load(nextSessionId: string | null): Promise<void> {
    const currentGeneration = ++generation
    sessionId.value = nextSessionId
    error.value = null
    currentRunId.value = null
    if (!nextSessionId) {
      state.value = null
      session.value = null
      tools.value = []
      stats.value = null
      timeline.value = []
      runs.value = []
      checkpoints.value = []
      evaluations.value = []
      loading.value = false
      return
    }
    loading.value = true
    try {
      const [nextState, nextSession, nextTimeline] = await Promise.all([
        callApi(() => getApi().harness.state(nextSessionId)),
        callApi(() => getApi().harness.session(nextSessionId)),
        callApi(() => getApi().harness.timeline(nextSessionId))
      ])
      if (currentGeneration !== generation || sessionId.value !== nextSessionId) return
      applyState(nextState)
      session.value = nextSession
      timeline.value = nextTimeline
      // Control-plane data loads in parallel; failures degrade the panel, not the console.
      void refreshRuns()
      void refreshCheckpoints()
      void refreshPolicy()
    } catch (cause) {
      if (currentGeneration === generation) error.value = errorMessage(cause)
    } finally {
      if (currentGeneration === generation) loading.value = false
    }
  }

  async function refresh(): Promise<void> {
    const id = sessionId.value
    if (!id) return
    const currentGeneration = generation
    try {
      const [nextState, nextSession] = await Promise.all([
        callApi(() => getApi().harness.state(id)),
        callApi(() => getApi().harness.session(id))
      ])
      if (currentGeneration !== generation || sessionId.value !== id) return
      applyState(nextState)
      session.value = nextSession
      error.value = null
    } catch (cause) {
      if (currentGeneration === generation) error.value = errorMessage(cause)
    }
  }

  async function refreshRuns(): Promise<void> {
    const id = sessionId.value
    if (!id) return
    const currentGeneration = generation
    try {
      const [nextRuns, nextEvaluations] = await Promise.all([
        callApi(() => getApi().harness.listRuns(id)),
        callApi(() => getApi().harness.listEvaluations(id))
      ])
      if (currentGeneration !== generation || sessionId.value !== id) return
      runs.value = nextRuns
      evaluations.value = nextEvaluations
    } catch {
      /* run history is best-effort; the console stays usable without it */
    }
  }

  async function refreshCheckpoints(): Promise<void> {
    const id = sessionId.value
    if (!id) return
    const currentGeneration = generation
    try {
      const nextCheckpoints = await callApi(() => getApi().harness.listCheckpoints(id))
      if (currentGeneration !== generation || sessionId.value !== id) return
      checkpoints.value = nextCheckpoints
    } catch {
      /* checkpoints are best-effort */
    }
  }

  async function refreshPolicy(): Promise<void> {
    try {
      policy.value = await callApi(() => getApi().harness.getPolicy())
    } catch {
      /* policy panel shows its error inline */
    }
  }

  async function savePolicy(config: HarnessPolicyConfig): Promise<void> {
    policy.value = await callApi(() => getApi().harness.setPolicy(config))
  }

  async function evaluateRun(runId: string): Promise<HarnessEvaluation> {
    const evaluation = await mutate((id) => getApi().harness.evaluateRun(id, runId))
    await refreshRuns()
    return evaluation
  }

  async function createCheckpoint(includeGit = true): Promise<HarnessCheckpoint> {
    const checkpoint = await mutate((id) => getApi().harness.createCheckpoint(id, includeGit))
    await refreshCheckpoints()
    return checkpoint
  }

  async function resumeCheckpoint(
    checkpointId: string,
    message?: string
  ): Promise<{ resumed: boolean; prompted: boolean }> {
    const result = await mutate((_id) => getApi().harness.resumeCheckpoint(checkpointId, message))
    await refreshCheckpoints()
    return result
  }

  async function forkCheckpoint(checkpointId: string): Promise<HarnessForkResult> {
    const result = await mutate((_id) => getApi().harness.forkCheckpoint(checkpointId))
    await refreshCheckpoints()
    return result
  }

  async function retryLastRun(): Promise<{ retried: boolean; prompt: string | null }> {
    const result = await mutate((id) => getApi().harness.retryLastRun(id))
    await refreshRuns()
    return result
  }

  async function setTools(toolNames: string[]): Promise<void> {
    await mutate(async (id) => getApi().harness.setTools(id, toolNames))
  }

  async function setThinkingLevel(level: string): Promise<void> {
    await mutate(async (id) => getApi().harness.setThinkingLevel(id, level))
  }

  async function setAutoCompaction(enabled: boolean): Promise<void> {
    await mutate(async (id) => getApi().harness.setAutoCompaction(id, enabled))
  }

  async function compact(instructions?: string): Promise<HarnessCompactionResult | unknown> {
    return mutate(async (id) => getApi().harness.compact(id, instructions))
  }

  async function abortCompaction(): Promise<void> {
    await mutate(async (id) => getApi().harness.abortCompaction(id))
  }

  async function abort(): Promise<void> {
    await mutate(async (id) => getApi().agent.abort(id))
  }

  async function steer(message: string): Promise<void> {
    await mutate(async (id) => getApi().harness.steer(id, message))
  }

  async function followUp(message: string): Promise<void> {
    await mutate(async (id) => getApi().harness.followUp(id, message))
  }

  async function fork(entryId: string): Promise<HarnessForkResult> {
    return mutate(async (id) => getApi().harness.fork(id, entryId))
  }

  async function navigateTree(entryId: string): Promise<void> {
    await mutate(async (id) => getApi().harness.navigateTree(id, entryId))
  }

  async function mutate<T>(operation: (id: string) => Promise<T>): Promise<T> {
    const id = sessionId.value
    if (!id) throw new Error('No Harness session selected')
    mutating.value = true
    error.value = null
    try {
      const result = await callApi(() => operation(id))
      await refresh()
      return result
    } catch (cause) {
      error.value = errorMessage(cause)
      throw cause
    } finally {
      mutating.value = false
    }
  }

  function applyState(next: HarnessState | null): void {
    state.value = next
    tools.value = next?.tools ?? []
    stats.value = next?.stats ?? null
  }

  function scheduleRefresh(): void {
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      void refresh()
    }, 80)
  }

  function scheduleRunsRefresh(): void {
    if (runsRefreshTimer) clearTimeout(runsRefreshTimer)
    runsRefreshTimer = setTimeout(() => {
      runsRefreshTimer = null
      void refreshRuns()
    }, 150)
  }

  return {
    sessionId,
    state,
    session,
    tools,
    stats,
    timeline,
    runs,
    currentRunId,
    currentRun,
    activeRun,
    checkpoints,
    evaluations,
    policy,
    loading,
    mutating,
    error,
    setupListeners,
    load,
    refresh,
    refreshRuns,
    refreshCheckpoints,
    refreshPolicy,
    savePolicy,
    evaluateRun,
    createCheckpoint,
    resumeCheckpoint,
    forkCheckpoint,
    retryLastRun,
    setTools,
    setThinkingLevel,
    setAutoCompaction,
    compact,
    abortCompaction,
    abort,
    steer,
    followUp,
    fork,
    navigateTree
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

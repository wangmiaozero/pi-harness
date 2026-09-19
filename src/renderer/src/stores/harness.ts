import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import type {
  HarnessArtifact,
  HarnessBaseline,
  HarnessCheckpoint,
  HarnessCompactionResult,
  HarnessEvent,
  HarnessEventEnvelope,
  HarnessEvaluation,
  HarnessExportResult,
  HarnessForkResult,
  HarnessPolicyConfig,
  HarnessPolicySnapshot,
  HarnessProjectStats,
  HarnessRun,
  HarnessRunComparison,
  HarnessRunDetail,
  HarnessRunTreeNode,
  HarnessSessionInfo,
  HarnessState,
  HarnessStats,
  HarnessStatsRange,
  HarnessStoreSettings,
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
  const runScope = ref<'session' | 'project'>('session')
  const currentRunId = ref<string | null>(null)
  const runDetail = shallowRef<HarnessRunDetail | null>(null)
  const runTree = shallowRef<HarnessRunTreeNode[]>([])
  const comparison = shallowRef<HarnessRunComparison | null>(null)
  const compareRunIdA = ref<string | null>(null)
  const compareRunIdB = ref<string | null>(null)
  const baseline = shallowRef<HarnessBaseline | null>(null)
  const projectStats = shallowRef<HarnessProjectStats | null>(null)
  const statsRange = ref<HarnessStatsRange>('7d')
  const artifacts = shallowRef<HarnessArtifact[]>([])
  const storeSettings = shallowRef<HarnessStoreSettings | null>(null)
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
      if (envelope.event.type === 'artifact.recorded') {
        void refreshArtifacts()
        if (runDetail.value?.run.id === envelope.event.runId) {
          void loadRunDetail(envelope.event.runId)
        }
      }
      if (envelope.event.type === 'run.forked') void refreshRunTree()
      if (envelope.event.type === 'baseline.changed') void refreshBaseline()
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
      runDetail.value = null
      runTree.value = []
      comparison.value = null
      baseline.value = null
      projectStats.value = null
      artifacts.value = []
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
      void refreshRunTree()
      void refreshCheckpoints()
      void refreshPolicy()
      void refreshBaseline()
      void refreshArtifacts()
      void refreshProjectStats()
      void refreshStoreSettings()
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
      void import('./compaction').then(({ useCompactionStore }) => {
        void useCompactionStore().flushPending(id)
      })
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
        callApi(() => getApi().harness.listRuns(id, runScope.value)),
        callApi(() => getApi().harness.listEvaluations(id))
      ])
      if (currentGeneration !== generation || sessionId.value !== id) return
      runs.value = nextRuns
      evaluations.value = nextEvaluations
    } catch {
      /* run history is best-effort; the console stays usable without it */
    }
  }

  async function setRunScope(scope: 'session' | 'project'): Promise<void> {
    runScope.value = scope
    await refreshRuns()
  }

  async function loadRunDetail(runId: string): Promise<HarnessRunDetail> {
    const id = sessionId.value
    if (!id) throw new Error('No Harness session selected')
    const detail = await callApi(() => getApi().harness.getRunDetail(id, runId))
    runDetail.value = detail
    currentRunId.value = runId
    return detail
  }

  async function refreshRunTree(): Promise<void> {
    const id = sessionId.value
    if (!id) return
    const currentGeneration = generation
    try {
      const tree = await callApi(() => getApi().harness.getRunTree(id))
      if (currentGeneration === generation) runTree.value = tree
    } catch {
      /* run tree is best-effort */
    }
  }

  async function loadComparison(runIdA: string, runIdB: string): Promise<HarnessRunComparison> {
    const id = sessionId.value
    if (!id) throw new Error('No Harness session selected')
    const result = await callApi(() => getApi().harness.compareRuns(id, runIdA, runIdB))
    comparison.value = result
    compareRunIdA.value = runIdA
    compareRunIdB.value = runIdB
    return result
  }

  async function refreshBaseline(): Promise<void> {
    const id = sessionId.value
    if (!id) return
    const currentGeneration = generation
    try {
      const next = await callApi(() => getApi().harness.getBaseline(id))
      if (currentGeneration === generation) baseline.value = next
    } catch {
      /* baseline is best-effort */
    }
  }

  async function setBaseline(runId: string): Promise<HarnessBaseline> {
    const next = await mutate((id) => getApi().harness.setBaseline(id, runId))
    baseline.value = next
    return next
  }

  async function refreshProjectStats(): Promise<void> {
    const id = sessionId.value
    if (!id) return
    const currentGeneration = generation
    try {
      const next = await callApi(() => getApi().harness.getProjectStats(id, statsRange.value))
      if (currentGeneration === generation) projectStats.value = next
    } catch {
      /* project stats are best-effort */
    }
  }

  async function setStatsRange(range: HarnessStatsRange): Promise<void> {
    statsRange.value = range
    await refreshProjectStats()
  }

  async function refreshArtifacts(runId?: string): Promise<void> {
    const id = sessionId.value
    if (!id) return
    const currentGeneration = generation
    try {
      const next = await callApi(() => getApi().harness.listArtifacts(id, runId))
      if (currentGeneration === generation) artifacts.value = next
    } catch {
      /* artifacts are best-effort */
    }
  }

  async function forkRun(
    runId: string,
    options: {
      mode?: 'fork' | 'rerun'
      fromEventId?: string
      fromCheckpointId?: string
      message?: string
    } = {}
  ): Promise<{ forked: boolean; newSessionId: string | null; newRunId: string | null }> {
    const result = await mutate((id) => getApi().harness.forkRun(id, runId, options))
    await refreshRuns()
    await refreshRunTree()
    return result
  }

  async function exportRun(runId: string, format: 'json' | 'markdown'): Promise<HarnessExportResult> {
    return mutate((id) => getApi().harness.exportRun(id, runId, format))
  }

  async function exportDebugBundle(runId?: string): Promise<HarnessExportResult> {
    return mutate((id) => getApi().harness.exportDebugBundle(id, runId))
  }

  async function refreshStoreSettings(): Promise<void> {
    try {
      storeSettings.value = await callApi(() => getApi().harness.getStoreSettings())
    } catch {
      /* store settings are best-effort */
    }
  }

  async function updateStoreSettings(
    settings: HarnessStoreSettings
  ): Promise<HarnessStoreSettings> {
    const next = await mutate((_id) => getApi().harness.updateStoreSettings(settings))
    storeSettings.value = next
    return next
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
    runScope,
    currentRunId,
    currentRun,
    activeRun,
    runDetail,
    runTree,
    comparison,
    compareRunIdA,
    compareRunIdB,
    baseline,
    projectStats,
    statsRange,
    artifacts,
    storeSettings,
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
    setRunScope,
    loadRunDetail,
    refreshRunTree,
    loadComparison,
    refreshBaseline,
    setBaseline,
    refreshProjectStats,
    setStatsRange,
    refreshArtifacts,
    forkRun,
    exportRun,
    exportDebugBundle,
    refreshStoreSettings,
    updateStoreSettings,
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

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import { i18n } from '@renderer/i18n'
import { callApi, getApi, getErrorPayload } from '@renderer/composables/useApi'
import { askConfirm } from '@renderer/composables/useConfirmDialog'
import {
  canRequestCompaction,
  inspectCompactionBusy,
  parseCompactionRuntimeResult,
  type CompactionResult,
  type CompactionSource
} from '@shared/workspace/compaction'
import { evaluateCompactionNeed } from '@shared/workspace/compaction-policy'
import { inspectRuntimeError } from '@shared/workspace/runtime-error'
import { useAgentStore } from './agent'
import { useHarnessStore } from './harness'
import { useSessionStore } from './sessions'

export type SmartCompactionInput = {
  sessionId?: string | null
  instruction?: string
  source?: CompactionSource
  force?: boolean
}

type PendingCompaction = {
  instruction?: string
  source: CompactionSource
}

export type CompactionButtonPhase = 'idle' | 'working' | 'queued' | 'compacting'

export const useCompactionStore = defineStore('compaction', () => {
  const pending = ref<Record<string, PendingCompaction>>({})
  const running = ref<Record<string, true>>({})
  const flushing = ref<Record<string, true>>({})

  const pendingSessionIds = computed(() => Object.keys(pending.value))

  function isQueued(sessionId: string | null | undefined): boolean {
    return Boolean(sessionId && pending.value[sessionId])
  }

  function isRunning(sessionId: string | null | undefined): boolean {
    return Boolean(sessionId && running.value[sessionId])
  }

  function buttonPhase(
    sessionId: string | null | undefined,
    source: CompactionSource = 'workspace'
  ): CompactionButtonPhase {
    if (!sessionId || !canRequestCompaction(sessionId)) return 'idle'
    if (isQueued(sessionId)) return 'queued'
    const busy = sessionBusy(sessionId, source)
    if (busy === 'compacting') return 'compacting'
    if (busy === 'working') return 'working'
    return 'idle'
  }

  function forgetSession(sessionId: string): void {
    if (!pending.value[sessionId] && !running.value[sessionId] && !flushing.value[sessionId]) {
      return
    }
    const nextPending = { ...pending.value }
    const nextRunning = { ...running.value }
    const nextFlushing = { ...flushing.value }
    delete nextPending[sessionId]
    delete nextRunning[sessionId]
    delete nextFlushing[sessionId]
    pending.value = nextPending
    running.value = nextRunning
    flushing.value = nextFlushing
  }

  async function requestSmartCompaction(input: SmartCompactionInput): Promise<CompactionResult> {
    const sessionId = input.sessionId ?? null
    const source = input.source ?? 'workspace'
    const instruction = input.instruction?.trim() || undefined
    if (!input.force && sessionId) {
      const decision = describeCompactionNeed(sessionId, source)
      if (decision.reason === 'too-little-content') {
        const t = i18n.global.t
        const confirmed = await askConfirm({
          title: String(t('workspace.compactLowBenefitTitle')),
          description: String(t('workspace.compactLowBenefit')),
          confirmLabel: String(t('workspace.compactAnyway')),
          cancelLabel: String(t('common.cancel')),
          tone: 'primary'
        })
        if (!confirmed) {
          const declined: CompactionResult = { status: 'declined' }
          return declined
        }
      }
    }
    const result = await routeSmartCompaction(sessionId, { instruction, source })
    notifyCompactionResult(result)
    return result
  }

  async function flushPending(sessionId: string): Promise<CompactionResult | null> {
    const item = pending.value[sessionId]
    if (!item || flushing.value[sessionId]) return null
    const busy = sessionBusy(sessionId, item.source)
    if (busy) return null
    flushing.value = { ...flushing.value, [sessionId]: true }
    const nextPending = { ...pending.value }
    delete nextPending[sessionId]
    pending.value = nextPending
    try {
      if (!sessionExists(sessionId, item.source)) {
        const missing: CompactionResult = { status: 'session-missing' }
        notifyCompactionResult(missing)
        return missing
      }
      const result = await executeCompaction(sessionId, item)
      notifyCompactionResult(result)
      return result
    } finally {
      const nextFlushing = { ...flushing.value }
      delete nextFlushing[sessionId]
      flushing.value = nextFlushing
    }
  }

  async function routeSmartCompaction(
    sessionId: string | null,
    request: PendingCompaction
  ): Promise<CompactionResult> {
    if (!canRequestCompaction(sessionId) || !sessionId) return { status: 'session-missing' }
    if (!sessionExists(sessionId, request.source)) return { status: 'session-missing' }

    const busy = sessionBusy(sessionId, request.source)
    if (busy === 'compacting' || running.value[sessionId]) return { status: 'already-running' }
    if (busy === 'working') {
      pending.value = {
        ...pending.value,
        [sessionId]: {
          source: request.source,
          instruction: request.instruction ?? pending.value[sessionId]?.instruction
        }
      }
      return { status: 'queued' }
    }
    return executeCompaction(sessionId, request)
  }

  async function executeCompaction(
    sessionId: string,
    request: PendingCompaction
  ): Promise<CompactionResult> {
    if (running.value[sessionId]) return { status: 'already-running' }
    if (!sessionExists(sessionId, request.source)) return { status: 'session-missing' }

    running.value = { ...running.value, [sessionId]: true }
    const tokensBefore = readUsageTokens(sessionId, request.source)
    try {
      const raw =
        request.source === 'harness'
          ? await callApi(() => getApi().harness.compact(sessionId, request.instruction))
          : await callApi(() =>
              getApi().agent.command(sessionId, {
                type: 'compact',
                ...(request.instruction ? { customInstructions: request.instruction } : {})
              })
            )
      if (!sessionExists(sessionId, request.source)) return { status: 'session-missing' }
      await refreshAfterCompact(sessionId, request.source)
      const parsed = parseCompactionRuntimeResult(raw)
      if (parsed.status !== 'compacted') return parsed
      const tokensAfter = readUsageTokens(sessionId, request.source)
      return {
        status: 'compacted',
        tokensBefore: parsed.tokensBefore ?? tokensBefore,
        ...(tokensAfter !== undefined ? { tokensAfter } : {}),
        ...(parsed.firstKeptEntryId ? { firstKeptEntryId: parsed.firstKeptEntryId } : {})
      }
    } catch (error) {
      return compactionFailure(error)
    } finally {
      const nextRunning = { ...running.value }
      delete nextRunning[sessionId]
      running.value = nextRunning
    }
  }

  function sessionBusy(
    sessionId: string,
    source: CompactionSource
  ): ReturnType<typeof inspectCompactionBusy> {
    if (running.value[sessionId]) return 'compacting'
    const agent = useAgentStore()
    if (source === 'harness') {
      const harness = useHarnessStore()
      if (harness.sessionId === sessionId) {
        return inspectCompactionBusy({
          isCompacting:
            harness.state?.runtime?.isCompacting === true ||
            harness.state?.compaction?.running === true,
          isStreaming: harness.state?.runtime?.isStreaming === true,
          isPromptRunning: harness.state?.runtime?.isPromptRunning === true,
          isBashRunning: harness.state?.runtime?.isBashRunning === true,
          running: harness.state?.runtime?.status === 'running'
        })
      }
    }
    if (agent.isSessionLoaded(sessionId) || useSessionStore().currentId === sessionId) {
      return inspectCompactionBusy({
        sending: agent.sending,
        isStreaming: agent.streaming.isStreaming || agent.state?.isStreaming === true,
        isPromptRunning: agent.state?.isPromptRunning === true,
        isBashRunning: agent.state?.isBashRunning === true,
        isCompacting: agent.state?.isCompacting === true,
        running: agent.runningIds.includes(sessionId)
      })
    }
    if (agent.runningIds.includes(sessionId)) return 'working'
    return null
  }

  function sessionExists(sessionId: string, source: CompactionSource): boolean {
    if (useSessionStore().items.some((session) => session.id === sessionId)) return true
    if (source === 'harness' && useHarnessStore().sessionId === sessionId) return true
    return false
  }

  function describeCompactionNeed(sessionId: string, source: CompactionSource) {
    const agent = useAgentStore()
    return evaluateCompactionNeed({
      sessionId,
      usage: readUsage(sessionId, source),
      messageCount: agent.isSessionLoaded(sessionId) ? agent.messages.length : 0,
      busy: sessionBusy(sessionId, source)
    })
  }

  function readUsage(
    sessionId: string,
    source: CompactionSource
  ): { tokens?: number | null; contextWindow?: number | null } | null {
    if (source === 'harness') {
      const harness = useHarnessStore()
      if (harness.sessionId === sessionId) {
        return {
          tokens: harness.state?.context?.tokens,
          contextWindow: harness.state?.context?.contextWindow
        }
      }
    }
    const agent = useAgentStore()
    if (!agent.isSessionLoaded(sessionId)) return null
    return agent.state?.contextUsage ?? null
  }

  function readUsageTokens(sessionId: string, source: CompactionSource): number | undefined {
    if (source === 'harness') {
      const harness = useHarnessStore()
      if (harness.sessionId === sessionId) {
        const tokens = harness.state?.context?.tokens
        return typeof tokens === 'number' && Number.isFinite(tokens) ? tokens : undefined
      }
    }
    const agent = useAgentStore()
    if (!agent.isSessionLoaded(sessionId)) return undefined
    const tokens = agent.state?.contextUsage?.tokens
    return typeof tokens === 'number' && Number.isFinite(tokens) ? tokens : undefined
  }

  async function refreshAfterCompact(sessionId: string, source: CompactionSource): Promise<void> {
    if (source === 'harness') {
      const harness = useHarnessStore()
      if (harness.sessionId === sessionId) await harness.refresh()
      return
    }
    const agent = useAgentStore()
    if (agent.isSessionLoaded(sessionId)) await agent.reconcile(sessionId)
  }

  return {
    pendingSessionIds,
    isQueued,
    isRunning,
    buttonPhase,
    forgetSession,
    requestSmartCompaction,
    flushPending
  }
})

function compactionFailure(error: unknown): CompactionResult {
  const payload = getErrorPayload(error)
  const code = String(payload.code ?? '')
  const message = `${payload.message ?? ''} ${payload.userMessage ?? ''}`
  if (code === 'CAPABILITY_NOT_SUPPORTED' || code === 'COMPACTION_NOT_AVAILABLE') {
    return { status: 'unsupported' }
  }
  if (code === 'SESSION_NOT_FOUND' || /no (harness )?session selected|session not found/i.test(message)) {
    return { status: 'session-missing' }
  }
  if (/Nothing to compact|session too small/i.test(message)) return { status: 'session-too-small' }
  if (/Already compacted/i.test(message)) return { status: 'already-compacted' }
  const runtime = inspectRuntimeError(error)
  return { status: 'failed', error: runtime.userMessage }
}

function notifyCompactionResult(result: CompactionResult): void {
  const t = i18n.global.t
  switch (result.status) {
    case 'declined':
      return
    case 'queued':
      toast.info(String(t('workspace.compactQueued')))
      return
    case 'already-running':
      toast.info(String(t('workspace.compactRunning')))
      return
    case 'session-too-small':
      toast.info(String(t('workspace.compactUnavailable')))
      return
    case 'already-compacted':
      toast.info(String(t('workspace.compactAlready')))
      return
    case 'session-missing':
      toast.info(String(t('workspace.compactSessionMissing')))
      return
    case 'unsupported':
      toast.info(String(t('workspace.compactUnsupported')))
      return
    case 'failed': {
      const runtime = inspectRuntimeError(result.error)
      if (runtime.kind === 'quota') {
        toast.error(
          runtime.resetAt
            ? String(t('workspace.quotaExceededUntil', { time: runtime.resetAt }))
            : String(t('workspace.quotaExceeded'))
        )
        return
      }
      toast.error(runtime.userMessage || String(t('workspace.compactFailed')))
      return
    }
    case 'compacted': {
      const before = result.tokensBefore
      const after = result.tokensAfter
      if (typeof before === 'number' && typeof after === 'number') {
        toast.success(
          String(
            t('workspace.compactDoneRange', {
              before: before.toLocaleString(),
              after: after.toLocaleString()
            })
          )
        )
        return
      }
      if (typeof before === 'number') {
        toast.success(
          String(t('workspace.compactDoneTokens', { tokens: before.toLocaleString() }))
        )
        return
      }
      toast.success(String(t('workspace.compactDone')))
    }
  }
}

import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import type {
  AgentEvent,
  AgentImageAttachment,
  AgentMessage,
  AgentStateSnapshot,
  ImageContent,
  SessionDetail,
  SessionStats,
  TextContent,
  ToolEntry
} from '@shared/types/workspace'
import {
  INITIAL_STREAMING_STATE,
  assistantHasRenderableContent,
  streamReducer,
  type StreamingState
} from '@shared/workspace/streaming-message'
import { normalizeToolCalls } from '@shared/workspace/normalize'
import type { ClientAssistantMessageEvent } from '@shared/workspace/agent-event-wire'
import { normalizeAgentEventEnvelopes } from '@shared/workspace/agent-event-wire'
import { callApi, getApi, getErrorMessage } from '@renderer/composables/useApi'
import { toComposerThinkingLevel } from '@shared/constants/index'
import { resolveThinkingLevel } from '@shared/thinking/levels'
import { inspectRuntimeError } from '@shared/workspace/runtime-error'
import {
  getPresetFromTools,
  getToolNamesForPreset,
  type ToolPreset
} from '@shared/workspace/tool-presets'
import { useModelsStore } from './models'
import { useSessionStore } from './sessions'
import { useWorkspaceStore } from './workspace'
import {
  forgetComposerCache,
  hydrateComposerSelections,
  rememberComposerCache,
  type ComposerSelection
} from './composer-cache'

export const useAgentStore = defineStore('agent', () => {
  const messages = shallowRef<AgentMessage[]>([])
  const entryIds = shallowRef<string[]>([])
  const entryParents = shallowRef<Record<string, string | null>>({})
  const streaming = shallowRef<StreamingState>(INITIAL_STREAMING_STATE)
  const state = shallowRef<AgentStateSnapshot | null>(null)
  const runningIds = ref<string[]>([])
  const tools = shallowRef<ToolEntry[]>([])
  const sessionStats = shallowRef<SessionStats | null>(null)
  const completionCount = ref(0)
  const error = ref<string | null>(null)
  const sending = ref(false)
  let loadedDetail: SessionDetail | null = null
  let loadedStatsOverride: Partial<SessionStats> | null = null
  let loadedSessionId: string | null = null
  let loadGeneration = 0
  const composerSelections = new Map<string, ComposerSelection>()
  const lastComposer = hydrateComposerSelections(composerSelections)
  const thinkingLevel = ref(lastComposer.thinkingLevel)
  const toolPreset = ref<ToolPreset>(lastComposer.toolPreset)
  const transientSessionIds = new Set<string>()
  let unsubEvent: (() => void) | null = null
  let unsubRunning: (() => void) | null = null

  function setupListeners() {
    unsubEvent?.()
    unsubRunning?.()
    unsubEvent = getApi().on('agent-event', (payload) => {
      for (const body of normalizeAgentEventEnvelopes(payload)) {
        if (!body.sessionId || !body.event) continue
        if (body.event.type === 'agent_end') void syncPersistedSession(body.sessionId)
        if (isCompactionSettleEvent(body.event.type)) {
          void flushQueuedCompaction(body.sessionId)
        }
        if (body.sessionId !== loadedSessionId) continue
        if (body.event.type === 'prompt_done') {
          const completionError =
            body.event.success === false
              ? inspectRuntimeError(body.event.errorMessage ?? 'Agent error').userMessage
              : undefined
          if (body.event.success === false) {
            error.value = completionError ?? 'Agent error'
            streaming.value = streamReducer(streaming.value, { type: 'end' })
          } else {
            completionCount.value += 1
          }
          void syncPersistedSession(body.sessionId, completionError)
        }
        applyEvent(body.event)
      }
    })
    unsubRunning = getApi().on('agent-running', (payload) => {
      const body = payload as { ids?: string[] }
      const previous = runningIds.value
      runningIds.value = body.ids ?? []
      for (const sessionId of previous) {
        if (!runningIds.value.includes(sessionId)) {
          void flushQueuedCompaction(sessionId)
        }
      }
    })
    return () => {
      unsubEvent?.()
      unsubRunning?.()
    }
  }

  function applyEvent(event: AgentEvent) {
    switch (event.type) {
      case 'agent_start':
        streaming.value = streamReducer(streaming.value, { type: 'start' })
        break
      case 'message_start': {
        const msg = event.message as AgentMessage | undefined
        if (msg?.role === 'assistant') {
          streaming.value = streamReducer(streaming.value, { type: 'snapshot', message: msg })
        }
        break
      }
      case 'message_update': {
        const delta = event.assistantMessageEvent as ClientAssistantMessageEvent | undefined
        if (delta) streaming.value = streamReducer(streaming.value, { type: 'delta', event: delta })
        const snapshot = event.message as AgentMessage | undefined
        if (
          snapshot?.role === 'assistant' &&
          assistantHasRenderableContent(snapshot) &&
          !assistantHasRenderableContent(streaming.value.streamingMessage)
        ) {
          streaming.value = streamReducer(streaming.value, { type: 'snapshot', message: snapshot })
        }
        break
      }
      case 'message_end': {
        const completed = event.message as AgentMessage | undefined
        if (completed && completed.role !== 'user') {
          const live = streaming.value.streamingMessage
          const stored =
            completed.role === 'assistant' &&
            !assistantHasRenderableContent(completed) &&
            live &&
            assistantHasRenderableContent(live)
              ? live
              : completed
          messages.value = [...messages.value, normalizeToolCalls(stored)]
          if (stored.role === 'assistant' && stored.errorMessage) {
            error.value = inspectRuntimeError(stored.errorMessage).userMessage
          }
        } else if (completed?.role === 'user') {
          const last = messages.value.at(-1)
          if (!(last?.role === 'user' && userText(last) === userText(completed))) {
            messages.value = [...messages.value, completed]
          }
        }
        loadedStatsOverride = null
        refreshLocalStats()
        streaming.value = streamReducer(streaming.value, { type: 'end' })
        break
      }
      case 'prompt_error':
        error.value = inspectRuntimeError(event.errorMessage ?? 'Agent error').userMessage
        streaming.value = streamReducer(streaming.value, { type: 'end' })
        break
      case 'compaction_start':
      case 'auto_compaction_start':
      case 'compaction_end':
      case 'auto_compaction_end':
      case 'agent_end':
      case 'agent_settled':
        void reconcile(loadedSessionId)
        break
      default:
        break
    }
  }

  async function load(sessionId: string | null) {
    const generation = ++loadGeneration
    loadedSessionId = sessionId
    error.value = null
    streaming.value = INITIAL_STREAMING_STATE
    if (!sessionId) {
      messages.value = []
      entryIds.value = []
      entryParents.value = {}
      state.value = null
      tools.value = []
      sessionStats.value = null
      loadedDetail = null
      loadedStatsOverride = null
      applyComposerSelection(readLastComposerPrefs())
      return
    }
    const savedSelection = composerSelections.get(sessionId)
    if (savedSelection) applyComposerSelection(savedSelection)
    else {
      thinkingLevel.value = 'auto'
      toolPreset.value = 'default'
    }
    if (transientSessionIds.has(sessionId)) {
      await reconcile(sessionId, !savedSelection, generation)
      if (isCurrentLoad(sessionId, generation) && !composerSelections.has(sessionId)) {
        rememberComposerSelection(sessionId)
      }
      return
    }
    const detail = await callApi(() => getApi().sessions.get(sessionId))
    if (!isCurrentLoad(sessionId, generation)) return
    loadedDetail = detail
    loadedStatsOverride = null
    messages.value = detail.context.messages
    entryIds.value = detail.context.entryIds
    entryParents.value = detail.context.entryParents ?? {}
    if (!savedSelection) {
      thinkingLevel.value = toComposerThinkingLevel(detail.context.thinkingLevel)
    }
    refreshLocalStats()
    await reconcile(sessionId, !savedSelection, generation)
    if (isCurrentLoad(sessionId, generation) && !composerSelections.has(sessionId)) {
      rememberComposerSelection(sessionId)
    }
  }

  async function reconcile(
    sessionId: string | null,
    initializeComposer = false,
    generation = loadGeneration
  ) {
    if (!sessionId) return
    try {
      let snap = await callApi(() => getApi().agent.state(sessionId))
      const running = await callApi(() => getApi().agent.running())
      if (!isCurrentLoad(sessionId, generation)) return
      runningIds.value = running
      let listed: ToolEntry[] | null = null
      try {
        listed = (await callApi(() =>
          getApi().agent.command(sessionId, { type: 'get_tools' })
        )) as ToolEntry[]
        if (!isCurrentLoad(sessionId, generation)) return
        tools.value = listed
        const stats = (await callApi(() =>
          getApi().agent.command(sessionId, { type: 'get_session_stats' })
        )) as Partial<SessionStats>
        if (!isCurrentLoad(sessionId, generation)) return
        loadedStatsOverride = stats
        sessionStats.value = deriveSessionStats(
          sessionId,
          messages.value,
          loadedDetail,
          loadedStatsOverride
        )
        if (!snap) snap = await callApi(() => getApi().agent.state(sessionId))
      } catch {
        /* session may not be live yet */
      }
      if (!isCurrentLoad(sessionId, generation)) return
      state.value = snap
      if (snap?.isStreaming) {
        streaming.value = { ...streaming.value, isStreaming: true }
      } else if (!snap?.isPromptRunning) {
        streaming.value = INITIAL_STREAMING_STATE
      }
      if (initializeComposer && !composerSelections.has(sessionId)) {
        if (snap?.thinkingLevel) {
          thinkingLevel.value = toComposerThinkingLevel(snap.thinkingLevel)
        }
        if (listed) toolPreset.value = getPresetFromTools(listed)
      }
    } catch {
      if (isCurrentLoad(sessionId, generation)) state.value = null
    }
  }

  async function send(
    sessionId: string | null,
    cwd: string | null,
    message: string,
    preset: ToolPreset,
    images: AgentImageAttachment[] = []
  ) {
    if (!message.trim() && !images.length) return
    sending.value = true
    error.value = null
    const imageBlocks: ImageContent[] = images.map((image) => ({
      type: 'image',
      data: image.data,
      mimeType: image.mimeType
    }))
    const textBlocks: TextContent[] = message.trim() ? [{ type: 'text', text: message }] : []
    const optimistic: AgentMessage = {
      role: 'user',
      content: imageBlocks.length ? [...textBlocks, ...imageBlocks] : message,
      timestamp: Date.now()
    }
    messages.value = [...messages.value, optimistic]
    let createdSessionId: string | null = null
    try {
      if (!sessionId) {
        if (!cwd) throw new Error('No project cwd')
        const started = await callApi(() =>
          getApi().agent.start({
            cwd,
            toolNames: getToolNamesForPreset(preset),
            ...(thinkingLevel.value !== 'auto'
              ? { thinkingLevel: resolveActivePiThinking(thinkingLevel.value) }
              : {})
          })
        )
        loadedSessionId = started.sessionId
        transientSessionIds.add(started.sessionId)
        composerSelections.set(started.sessionId, {
          thinkingLevel: thinkingLevel.value,
          toolPreset: preset
        })
        toolPreset.value = preset
        createdSessionId = started.sessionId
        useSessionStore().addTransientSession(
          started.sessionId,
          started.cwd,
          message.trim() || '[image]'
        )
        void useWorkspaceStore().bindCurrentSession(started.sessionId)
        await callApi(() =>
          getApi().agent.prompt({
            sessionId: started.sessionId,
            message,
            ...(images.length ? { images } : {})
          })
        )
        return started.sessionId
      }
      const snap = await callApi(() => getApi().agent.state(sessionId))
      if (snap?.isStreaming || snap?.isPromptRunning) {
        await callApi(() =>
          getApi().agent.prompt({
            sessionId,
            message,
            streamingBehavior: 'followUp',
            ...(images.length ? { images } : {})
          })
        )
      } else {
        await callApi(() =>
          getApi().agent.start({
            sessionId,
            toolNames: getToolNamesForPreset(toolPreset.value),
            ...(thinkingLevel.value !== 'auto'
              ? { thinkingLevel: resolveActivePiThinking(thinkingLevel.value) }
              : {})
          })
        )
        await callApi(() =>
          getApi().agent.prompt({ sessionId, message, ...(images.length ? { images } : {}) })
        )
      }
      return sessionId
    } catch (e) {
      error.value = getErrorMessage(e)
      messages.value = messages.value.slice(0, -1)
      if (createdSessionId) {
        transientSessionIds.delete(createdSessionId)
        composerSelections.delete(createdSessionId)
        useSessionStore().removeTransientSession(createdSessionId)
      }
      return sessionId
    } finally {
      sending.value = false
    }
  }

  async function abort(sessionId: string) {
    await callApi(() => getApi().agent.abort(sessionId))
  }

  async function compact(sessionId: string, instructions?: string) {
    error.value = null
    try {
      return (await callApi(() =>
        getApi().agent.command(sessionId, {
          type: 'compact',
          ...(instructions ? { customInstructions: instructions } : {})
        })
      )) as {
        cancelled?: boolean
        reason?: 'session-too-small' | 'already-compacted'
      } | null
    } catch (e) {
      error.value = getErrorMessage(e)
      return null
    }
  }

  async function setAutoCompaction(sessionId: string, enabled: boolean) {
    await callApi(() =>
      getApi().agent.command(sessionId, { type: 'set_auto_compaction', enabled })
    )
    if (loadedSessionId === sessionId) await reconcile(sessionId)
  }

  function isSessionLoaded(sessionId: string) {
    return loadedSessionId === sessionId
  }

  async function syncPersistedSession(sessionId: string, terminalError?: string) {
    const sessions = useSessionStore()
    await sessions.refresh(true)
    if (!sessions.items.some((session) => session.id === sessionId && !session.transient)) return
    transientSessionIds.delete(sessionId)
    if (loadedSessionId === sessionId) await load(sessionId)
    if (terminalError && loadedSessionId === sessionId) error.value = terminalError
  }

  async function setThinking(sessionId: string, level: string) {
    const previous = composerSelections.get(sessionId) ?? {
      thinkingLevel: thinkingLevel.value,
      toolPreset: toolPreset.value
    }
    thinkingLevel.value = level
    rememberComposerSelection(sessionId)
    if (level === 'auto') return
    try {
      await callApi(() =>
        getApi().agent.command(sessionId, {
          type: 'set_thinking_level',
          level: resolveActivePiThinking(level)
        })
      )
    } catch (cause) {
      composerSelections.set(sessionId, previous)
      if (loadedSessionId === sessionId) applyComposerSelection(previous)
      throw cause
    }
  }

  async function setTools(sessionId: string, preset: ToolPreset) {
    const previous = composerSelections.get(sessionId) ?? {
      thinkingLevel: thinkingLevel.value,
      toolPreset: toolPreset.value
    }
    toolPreset.value = preset
    rememberComposerSelection(sessionId)
    try {
      await callApi(() =>
        getApi().agent.command(sessionId, {
          type: 'set_tools',
          toolNames: getToolNamesForPreset(preset)
        })
      )
      const listed = (await callApi(() =>
        getApi().agent.command(sessionId, { type: 'get_tools' })
      )) as ToolEntry[]
      if (loadedSessionId === sessionId) tools.value = listed
    } catch (cause) {
      composerSelections.set(sessionId, previous)
      if (loadedSessionId === sessionId) applyComposerSelection(previous)
      throw cause
    }
  }

  async function setModel(sessionId: string, provider: string, modelId: string) {
    await callApi(() => getApi().agent.command(sessionId, { type: 'set_model', provider, modelId }))
    const snapshot = await callApi(() => getApi().agent.state(sessionId))
    if (loadedSessionId === sessionId) state.value = snapshot
  }

  async function navigate(sessionId: string, targetId: string) {
    await callApi(() => getApi().agent.command(sessionId, { type: 'navigate_tree', targetId }))
    await load(sessionId)
  }

  async function fork(sessionId: string, entryId: string) {
    const result = (await callApi(() =>
      getApi().agent.command(sessionId, { type: 'fork', entryId })
    )) as { cancelled?: boolean; newSessionId?: string }
    return result
  }

  const activePreset = () => toolPreset.value

  function rememberComposerSelection(sessionId: string | null) {
    const selection = {
      thinkingLevel: thinkingLevel.value,
      toolPreset: toolPreset.value
    }
    if (sessionId) composerSelections.set(sessionId, selection)
    rememberComposerCache(sessionId, selection)
  }

  function applyComposerSelection(selection: ComposerSelection) {
    thinkingLevel.value = selection.thinkingLevel
    toolPreset.value = selection.toolPreset
  }

  function readLastComposerPrefs(): ComposerSelection {
    return hydrateComposerSelections(composerSelections)
  }

  function forgetComposerSelection(sessionId: string) {
    composerSelections.delete(sessionId)
    forgetComposerCache(sessionId)
  }

  function isCurrentLoad(sessionId: string, generation: number) {
    return loadedSessionId === sessionId && loadGeneration === generation
  }

  function refreshLocalStats() {
    if (!loadedSessionId) {
      sessionStats.value = null
      return
    }
    sessionStats.value = deriveSessionStats(
      loadedSessionId,
      messages.value,
      loadedDetail,
      loadedStatsOverride ?? undefined
    )
  }

  return {
    messages,
    entryIds,
    entryParents,
    streaming,
    state,
    runningIds,
    tools,
    thinkingLevel,
    toolPreset,
    sessionStats,
    completionCount,
    error,
    sending,
    setupListeners,
    load,
    reconcile,
    send,
    abort,
    compact,
    setAutoCompaction,
    isSessionLoaded,
    rememberComposerSelection,
    forgetComposerSelection,
    setThinking,
    setTools,
    setModel,
    navigate,
    fork,
    activePreset
  }
})

function flushQueuedCompaction(sessionId: string): void {
  void import('./compaction').then(({ useCompactionStore }) => {
    void useCompactionStore().flushPending(sessionId)
  })
}

function resolveActivePiThinking(level: string): string {
  const models = useModelsStore()
  const model = models.items.find((item) => item.modelId === models.active.modelId)
  return resolveThinkingLevel({
    requested: level,
    supportedLevels: model?.thinkingLevels
  })
}

function isCompactionSettleEvent(type: string): boolean {
  return (
    type === 'prompt_done' ||
    type === 'prompt_error' ||
    type === 'agent_end' ||
    type === 'agent_settled' ||
    type === 'compaction_end' ||
    type === 'auto_compaction_end'
  )
}

function userText(message: AgentMessage): string {
  if (message.role !== 'user') return ''
  return typeof message.content === 'string'
    ? message.content
    : message.content
        .filter((b) => b.type === 'text')
        .map((b) => (b.type === 'text' ? b.text : ''))
        .join('\n')
}

function deriveSessionStats(
  sessionId: string,
  messages: AgentMessage[],
  detail: SessionDetail | null,
  raw?: Partial<SessionStats>
): SessionStats {
  const fallback = {
    userMessages: 0,
    assistantMessages: 0,
    toolCalls: 0,
    toolResults: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0
  }
  for (const message of messages) {
    if (message.role === 'user') fallback.userMessages += 1
    if (message.role === 'toolResult') fallback.toolResults += 1
    if (message.role !== 'assistant') continue
    fallback.assistantMessages += 1
    fallback.toolCalls += message.content.filter((block) => block.type === 'toolCall').length
    const usage = message.usage
    if (!usage) continue
    fallback.tokens.input += usage.input ?? 0
    fallback.tokens.output += usage.output ?? 0
    fallback.tokens.cacheRead += usage.cacheRead ?? 0
    fallback.tokens.cacheWrite += usage.cacheWrite ?? 0
    fallback.cost += usage.cost?.total ?? 0
  }
  fallback.tokens.total =
    fallback.tokens.input +
    fallback.tokens.output +
    fallback.tokens.cacheRead +
    fallback.tokens.cacheWrite

  const rawTokens = raw?.tokens
  const numberOr = (value: unknown, defaultValue: number) =>
    typeof value === 'number' && Number.isFinite(value) ? value : defaultValue
  const tokens = {
    input: numberOr(rawTokens?.input, fallback.tokens.input),
    output: numberOr(rawTokens?.output, fallback.tokens.output),
    cacheRead: numberOr(rawTokens?.cacheRead, fallback.tokens.cacheRead),
    cacheWrite: numberOr(rawTokens?.cacheWrite, fallback.tokens.cacheWrite),
    total: 0
  }
  tokens.total = numberOr(
    rawTokens?.total,
    tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite
  )

  return {
    sessionFile: raw?.sessionFile || detail?.filePath || undefined,
    sessionId: raw?.sessionId || sessionId,
    sessionName: raw?.sessionName || detail?.info?.name || undefined,
    userMessages: numberOr(raw?.userMessages, fallback.userMessages),
    assistantMessages: numberOr(raw?.assistantMessages, fallback.assistantMessages),
    toolCalls: numberOr(raw?.toolCalls, fallback.toolCalls),
    toolResults: numberOr(raw?.toolResults, fallback.toolResults),
    totalMessages: numberOr(raw?.totalMessages, messages.length),
    tokens,
    cost: numberOr(raw?.cost, fallback.cost),
    totalActiveMs: numberOr(raw?.totalActiveMs, detail?.totalActiveMs ?? 0)
  }
}

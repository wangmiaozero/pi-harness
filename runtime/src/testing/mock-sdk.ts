/**
 * In-memory Pi SDK test double.
 *
 * Mirrors the structural surface of `@earendil-works/pi-coding-agent` that the
 * runtime consumes (see `pi/types.ts`). No filesystem, no network — every
 * session lives in memory, events are emitted by test code. This keeps the
 * runtime unit tests hermetic and free of any API-token usage (task §33).
 */

import type {
  AgentSessionLike,
  PiCodingAgentModuleLike,
  PiSessionInfoLike,
  PiSessionManagerLike
} from '../pi/types.js'

export type MockEvent = { type: string; [key: string]: unknown }

export interface MockSessionHandle {
  session: AgentSessionLike & { __emit(event: MockEvent): void }
  sessionManager: PiSessionManagerLike
  prompts: Array<{ message: string; options?: Record<string, unknown> }>
  aborts: number
  compactions: Array<string | undefined>
  thinkingLevels: string[]
  toolSets: string[][]
  destroyed: boolean
}

/** Per-test SDK state so each `createMockSdk()` gets an isolated world. */
export interface MockSdkWorld {
  sessions: Map<string, MockSessionHandle>
  /** Entries registered for `SessionManager.listAll`. */
  listing: PiSessionInfoLike[]
  /** Session files for `SessionManager.open(path)`. */
  files: Map<string, MockSessionHandle>
  module: PiCodingAgentModuleLike
  loadCount: number
}

export function createMockSdkWorld(agentDir = '/tmp/pi-harness-test/agent'): MockSdkWorld {
  const world: MockSdkWorld = {
    sessions: new Map(),
    listing: [],
    files: new Map(),
    loadCount: 0,
    module: null as unknown as PiCodingAgentModuleLike
  }

  function makeSession(cwd: string, sessionId: string): MockSessionHandle {
    const prompts: Array<{ message: string; options?: Record<string, unknown> }> = []
    const compactions: Array<string | undefined> = []
    const thinkingLevels: string[] = []
    const toolSets: string[][] = []
    const listeners = new Set<(event: MockEvent) => void>()
    const manager = {
      cwd,
      file: `${agentDir}/sessions/${sessionId}.jsonl`,
      entries: [] as Array<{ id: string; type: string; [key: string]: unknown }>,
      getCwd: () => cwd,
      getSessionFile: () => manager.file,
      getSessionId: () => sessionId,
      getSessionName: () => `session-${sessionId}`,
      getEntries: () => manager.entries,
      getEntry: (id: string) => manager.entries.find((e) => e.id === id) ?? null,
      getHeader: () => ({ id: sessionId, cwd, timestamp: new Date().toISOString() }),
      getLeafId: () => null,
      getBranch: () => [],
      getSessionDir: () => `${agentDir}/sessions`,
      isPersisted: () => true,
      newSession: () => {},
      createBranchedSession: () => null,
      appendSessionInfo: () => {}
    }
    const handle: MockSessionHandle = {
      prompts,
      aborts: 0,
      compactions,
      thinkingLevels,
      toolSets,
      destroyed: false,
      sessionManager: manager as unknown as PiSessionManagerLike,
      session: null as unknown as AgentSessionLike & { __emit(event: MockEvent): void }
    }

    const allTools = [
      { name: 'read', description: 'Read files' },
      { name: 'bash', description: 'Run commands' },
      { name: 'edit', description: 'Edit files' },
      { name: 'weather', description: 'Extension tool' }
    ]
    let activeTools = ['read', 'bash', 'edit']

    const session = {
      sessionId,
      sessionFile: manager.file,
      sessionManager: handle.sessionManager,
      isStreaming: false,
      isBashRunning: false,
      isCompacting: false,
      autoCompactionEnabled: true,
      autoRetryEnabled: false,
      pendingMessageCount: 0,
      model: { id: 'test-model', provider: 'test-provider', input: ['text'] },
      thinkingLevel: 'off',
      agent: { state: { systemPrompt: 'You are a test agent.' } },
      modelRuntime: {
        getModel: (provider: string, modelId: string) =>
          provider === 'test-provider' && modelId === 'test-model'
            ? { id: modelId, provider, input: ['text'] }
            : undefined,
        refresh: async () => {}
      },
      settingsManager: { getBlockImages: () => false },
      subscribe(listener: (event: MockEvent) => void): () => void {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      async prompt(message: string, options?: Record<string, unknown>) {
        prompts.push({ message, options })
        handle.session.isStreaming = true
      },
      async abort() {
        handle.aborts += 1
        handle.session.isStreaming = false
      },
      abortCompaction() {
        handle.session.isCompacting = false
      },
      abortBash() {},
      async compact(instructions?: string) {
        compactions.push(instructions)
        handle.session.isCompacting = true
        for (const listener of listeners) listener({ type: 'compaction_start' })
        const result = { cancelled: false, keptMessages: 2, removedMessages: 3 }
        handle.session.isCompacting = false
        for (const listener of listeners) listener({ type: 'compaction_end', result })
        return result
      },
      async navigateTree(targetId: string) {
        return { cancelled: false, targetId }
      },
      async setModel(model: { id: string; provider: string }) {
        handle.session.model = { ...handle.session.model, ...model } as typeof handle.session.model
      },
      setThinkingLevel(level: string) {
        thinkingLevels.push(level)
        handle.session.thinkingLevel = level
      },
      getAvailableThinkingLevels: () => ['off', 'low', 'high'],
      setSessionName() {},
      setAutoCompactionEnabled(enabled: boolean) {
        handle.session.autoCompactionEnabled = enabled
      },
      setActiveToolsByName(names: string[]) {
        activeTools = [...names]
      },
      getAllTools: () => allTools,
      getActiveToolNames: () => [...activeTools],
      getContextUsage: () => ({ percent: 42, contextWindow: 200000, tokens: 84000 }),
      getSessionStats: () => ({ totalTokens: 84000, turns: 3 }),
      supportsThinking: () => true,
      async steer(message: string) {
        prompts.push({ message, options: { streamingBehavior: 'steer' } })
      },
      async followUp(message: string) {
        prompts.push({ message, options: { streamingBehavior: 'followUp' } })
      },
      setSteeringMode() {},
      setFollowUpMode() {},
      hasActiveModelApiKey: () => true,
      dispose() {
        handle.destroyed = true
        listeners.clear()
      },
      __emit(event: MockEvent) {
        for (const listener of listeners) listener(event)
      }
    } as unknown as AgentSessionLike & { __emit(event: MockEvent): void; dispose(): void }

    handle.session = session
    return handle
  }

  world.module = {
    VERSION: '0.84.2-mock',
    SessionManager: {
      create(cwd: string) {
        const sessionId = `new-${world.sessions.size + 1}`
        const handle = makeSession(cwd, sessionId)
        world.sessions.set(sessionId, handle)
        return handle.sessionManager
      },
      open(filePath: string) {
        const handle = world.files.get(filePath)
        if (!handle) {
          throw new Error(`mock: no session file ${filePath}`)
        }
        world.sessions.set(handle.session.sessionId, handle)
        return handle.sessionManager
      },
      async listAll() {
        return world.listing
      }
    },
    async createAgentSessionServices() {
      return {
        settingsManager: { getBlockImages: () => false },
        modelRuntime: {
          getModel: (provider: string, modelId: string) =>
            provider === 'test-provider' && modelId === 'test-model'
              ? { id: modelId, provider, input: ['text'] }
              : undefined,
          refresh: async () => {}
        }
      }
    },
    async createAgentSessionFromServices({
      sessionManager
    }: {
      sessionManager: PiSessionManagerLike
    }) {
      const sessionId = sessionManager.getSessionId()
      let handle = world.sessions.get(sessionId)
      if (!handle) {
        handle = makeSession(sessionManager.getCwd(), sessionId)
        handle.sessionManager = sessionManager
        handle.session.sessionManager = sessionManager
        world.sessions.set(sessionId, handle)
      }
      return { session: handle.session, diagnostics: [] }
    },
    buildContextEntries: (entries: unknown[]) => entries,
    buildSessionContext: () => ({
      thinkingLevel: 'off',
      model: { provider: 'test-provider', modelId: 'test-model' }
    }),
    sessionEntryToContextMessages: (entry: unknown) => [entry],
    getAgentDir: () => agentDir,
    initTheme: () => {}
  } as unknown as PiCodingAgentModuleLike

  return world
}

/** Loader that counts loads (for lazy-load assertions). */
export function mockSdkLoader(world: MockSdkWorld) {
  return async () => {
    world.loadCount += 1
    return world.module
  }
}

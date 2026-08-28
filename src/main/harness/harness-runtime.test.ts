import { describe, expect, it, vi } from 'vitest'
import type { AgentStateSnapshot } from '@shared/types/workspace'
import type {
  HarnessCapabilities,
  HarnessEvent,
  HarnessState,
  HarnessStats
} from '@shared/types/harness'
import type { HarnessAdapter } from './harness-types'
import { HarnessRuntime } from './harness-runtime'

describe('HarnessRuntime', () => {
  it('owns the stable timeline while delegating execution to Pi', async () => {
    const { adapter, emitAgentEvent } = createAdapter()
    const runtime = new HarnessRuntime(adapter)
    const listener = vi.fn()
    runtime.onEvent(listener)

    await runtime.start({ sessionId: 'session-1' })
    await runtime.prompt('session-1', 'hello')
    emitAgentEvent({ type: 'tool.started', timestamp: 3, toolName: 'read' })
    emitAgentEvent({ type: 'tool.completed', timestamp: 4, toolName: 'read' })

    expect(adapter.startSession).toHaveBeenCalledWith({ sessionId: 'session-1' })
    expect(adapter.prompt).toHaveBeenCalledWith('session-1', 'hello', {})
    expect(runtime.getTimeline('session-1').map((event) => event.type)).toEqual([
      'session.started',
      'prompt.started',
      'tool.started',
      'tool.completed'
    ])
    expect(listener).toHaveBeenCalledTimes(4)
  })

  it('keeps legacy tool presets extension-safe and Inspector selections exact', async () => {
    const { adapter } = createAdapter()
    const runtime = new HarnessRuntime(adapter)

    await runtime.command('session-1', { type: 'set_tools', toolNames: ['read'] })
    await runtime.setTools('session-1', ['read'])

    expect(adapter.setTools).toHaveBeenNthCalledWith(1, 'session-1', ['read'], {
      preserveExtensionTools: true
    })
    expect(adapter.setTools).toHaveBeenNthCalledWith(2, 'session-1', ['read'], {
      preserveExtensionTools: false
    })
  })

  it('records unsupported operation failures without swallowing the adapter error', async () => {
    const { adapter } = createAdapter()
    const runtime = new HarnessRuntime(adapter)
    vi.mocked(adapter.prompt).mockRejectedValueOnce(
      Object.assign(new Error('Prompt unavailable'), { code: 'CAPABILITY_NOT_SUPPORTED' })
    )

    await expect(runtime.prompt('session-1', 'hello')).rejects.toMatchObject({
      code: 'CAPABILITY_NOT_SUPPORTED'
    })
    expect(runtime.getTimeline('session-1').at(-1)).toMatchObject({
      type: 'runtime.error',
      message: 'Prompt unavailable'
    })
  })

  it('maps normal Pi compaction no-ops into a non-error timeline event', async () => {
    const { adapter } = createAdapter()
    const runtime = new HarnessRuntime(adapter)
    vi.mocked(adapter.compact).mockResolvedValueOnce({
      cancelled: true,
      reason: 'session-too-small'
    })

    await runtime.compact('session-1')

    expect(runtime.getTimeline('session-1').at(-1)).toMatchObject({
      type: 'compaction.skipped',
      reason: 'session-too-small'
    })
  })
})

function createAdapter() {
  let eventListener: ((event: HarnessEvent) => void) | null = null
  const adapter: HarnessAdapter = {
    diagnostics: vi.fn(() => ({ implementation: 'pi' as const, sdkLoaded: true })),
    listRunning: vi.fn(() => []),
    startSession: vi.fn(async () => ({ sessionId: 'session-1', cwd: '/tmp/project' })),
    stopSession: vi.fn(async () => undefined),
    prompt: vi.fn(async () => undefined),
    abort: vi.fn(async () => undefined),
    steer: vi.fn(async () => undefined),
    followUp: vi.fn(async () => undefined),
    getAgentState: vi.fn(async () => agentState()),
    getState: vi.fn(async () => harnessState()),
    getCapabilities: vi.fn(async () => capabilities()),
    getTools: vi.fn(async () => [{ name: 'read', description: 'Read', active: true }]),
    setTools: vi.fn(async () => undefined),
    setModel: vi.fn(async () => undefined),
    setThinkingLevel: vi.fn(async () => undefined),
    compact: vi.fn(async () => undefined),
    abortCompaction: vi.fn(async () => undefined),
    setAutoCompaction: vi.fn(async () => undefined),
    fork: vi.fn(async () => ({ cancelled: false, newSessionId: 'session-2' })),
    navigateTree: vi.fn(async () => undefined),
    getStats: vi.fn(async () => stats()),
    getSession: vi.fn(async () => ({
      sessionId: 'session-1',
      persisted: true,
      leafId: null,
      entries: []
    })),
    subscribe: vi.fn((_sessionId, listener) => {
      eventListener = listener
      return () => {
        eventListener = null
      }
    }),
    executeAgentCommand: vi.fn(async () => undefined),
    defaultToolNames: vi.fn(() => ['read']),
    shutdownAll: vi.fn(async () => undefined)
  }
  return {
    adapter,
    emitAgentEvent(event: HarnessEvent) {
      eventListener?.(event)
    }
  }
}

function capabilities(): HarnessCapabilities {
  return {
    prompt: true,
    abort: true,
    steering: true,
    followUp: true,
    compaction: true,
    autoCompaction: true,
    thinkingLevel: true,
    tools: true,
    sessionFork: true,
    sessionTree: true,
    modelSwitch: true,
    contextUsage: true,
    stats: true
  }
}

function agentState(): AgentStateSnapshot {
  return {
    sessionId: 'session-1',
    sessionFile: '/tmp/session.jsonl',
    status: 'idle',
    isStreaming: false,
    isPromptRunning: false,
    isBashRunning: false,
    isCompacting: false,
    autoCompactionEnabled: true,
    thinkingLevel: 'off',
    contextUsage: null,
    pendingMessageCount: 0,
    queuedMessages: { steering: [], followUp: [] }
  }
}

function stats(): HarnessStats {
  return { sessionId: 'session-1', activeTools: 1, pendingMessages: 0 }
}

function harnessState(): HarnessState {
  return {
    sessionId: 'session-1',
    runtime: {
      status: 'idle',
      isStreaming: false,
      isPromptRunning: false,
      isBashRunning: false,
      isCompacting: false
    },
    thinking: { level: 'off', options: ['off'] },
    context: null,
    compaction: { auto: true, running: false },
    queue: { pendingMessages: 0, steering: [], followUp: [] },
    tools: [{ name: 'read', description: 'Read', active: true }],
    capabilities: capabilities(),
    stats: stats()
  }
}

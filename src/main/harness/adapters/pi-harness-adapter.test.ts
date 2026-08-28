import { describe, expect, it, vi } from 'vitest'
import type { AgentRuntimeService, AgentSessionWrapper } from '../../agent/agent-runtime-service'
import type { AgentSessionLike, PiSessionManagerLike } from '../../agent/pi-sdk'
import type { AgentStateSnapshot } from '@shared/types/workspace'
import { PiHarnessAdapter } from './pi-harness-adapter'

describe('PiHarnessAdapter', () => {
  it('maps Pi tools, context, stats, thinking options, and queues into HarnessState', async () => {
    const { adapter } = createAdapter()

    const state = await adapter.getState('session-1')

    expect(state).toMatchObject({
      sessionId: 'session-1',
      thinking: { level: 'high', options: ['off', 'high'] },
      context: { tokens: 64, contextWindow: 128, percent: 50 },
      queue: { pendingMessages: 2, steering: ['now'], followUp: ['later'] },
      stats: { totalMessages: 4, activeTools: 1, pendingMessages: 2 }
    })
    expect(state?.tools).toEqual([
      { name: 'read', description: 'Read files', active: true },
      { name: 'extension_x', description: 'Extension', active: false }
    ])
  })

  it('sets the exact Inspector tool selection but preserves extension tools for legacy presets', async () => {
    const { adapter, command } = createAdapter()

    await adapter.setTools('session-1', ['read'])
    await adapter.setTools('session-1', ['read'], { preserveExtensionTools: true })

    expect(command).toHaveBeenNthCalledWith(1, 'session-1', {
      type: 'set_tools',
      toolNames: ['read'],
      preserveExtensionTools: false
    })
    expect(command).toHaveBeenNthCalledWith(2, 'session-1', {
      type: 'set_tools',
      toolNames: ['read'],
      preserveExtensionTools: true
    })
    await expect(adapter.setTools('session-1', ['missing'])).rejects.toMatchObject({
      code: 'TOOL_NOT_FOUND'
    })
  })

  it('returns a capability error when an optional Pi API is unavailable', async () => {
    const { adapter, inner } = createAdapter()
    inner.steer = undefined

    await expect(adapter.steer('session-1', 'change direction')).rejects.toMatchObject({
      code: 'CAPABILITY_NOT_SUPPORTED'
    })
  })

  it('keeps state available when an advertised optional getter fails', async () => {
    const { adapter, inner } = createAdapter()
    inner.getAllTools = () => {
      throw new Error('unsupported')
    }

    await expect(adapter.getState('session-1')).resolves.toMatchObject({
      sessionId: 'session-1',
      tools: [],
      capabilities: { tools: false }
    })
  })

  it('preserves normal compaction no-op results from Pi', async () => {
    const { adapter, command } = createAdapter()
    command.mockResolvedValueOnce({ cancelled: true, reason: 'session-too-small' })

    await expect(adapter.compact('session-1')).resolves.toEqual({
      cancelled: true,
      reason: 'session-too-small'
    })
  })
})

function createAdapter() {
  const inner = createSession()
  const snapshot = createSnapshot()
  const wrapper = {
    inner,
    isAlive: () => true,
    snapshot: () => snapshot
  } as AgentSessionWrapper
  const command = vi.fn<(sessionId: string, command: Record<string, unknown>) => Promise<unknown>>(
    async () => undefined
  )
  const agent = {
    diagnostics: () => ({ implementation: 'pi', sdkLoaded: true }),
    listRunning: () => ['session-1'],
    start: vi.fn(),
    stop: vi.fn(),
    prompt: vi.fn(),
    abort: vi.fn(),
    getState: vi.fn(async () => snapshot),
    get: vi.fn(() => wrapper),
    getTools: vi.fn(async () => [
      { name: 'read', description: 'Read files', active: true },
      { name: 'extension_x', description: 'Extension', active: false }
    ]),
    command,
    subscribe: vi.fn(() => () => undefined),
    defaultToolNames: () => ['read'],
    shutdownAll: vi.fn()
  }
  return {
    adapter: new PiHarnessAdapter(agent as unknown as AgentRuntimeService),
    agent,
    command,
    inner
  }
}

function createSnapshot(): AgentStateSnapshot {
  return {
    sessionId: 'session-1',
    sessionFile: '/tmp/session.jsonl',
    status: 'idle',
    isStreaming: false,
    isPromptRunning: false,
    isBashRunning: false,
    isCompacting: false,
    autoCompactionEnabled: true,
    model: { provider: 'anthropic', id: 'sonnet' },
    thinkingLevel: 'high',
    contextUsage: { tokens: 64, contextWindow: 128, percent: 50 },
    pendingMessageCount: 2,
    queuedMessages: { steering: ['now'], followUp: ['later'] }
  }
}

function createSession(): AgentSessionLike {
  return {
    sessionId: 'session-1',
    sessionFile: '/tmp/session.jsonl',
    sessionManager: createManager(),
    isStreaming: false,
    isBashRunning: false,
    isCompacting: false,
    autoCompactionEnabled: true,
    model: { provider: 'anthropic', id: 'sonnet' },
    agent: { state: { thinkingLevel: 'high' } },
    modelRuntime: { getModel: vi.fn(), refresh: vi.fn() },
    subscribe: vi.fn(() => () => undefined),
    prompt: vi.fn(),
    abort: vi.fn(),
    abortCompaction: vi.fn(),
    compact: vi.fn(),
    navigateTree: vi.fn(),
    setModel: vi.fn(),
    setThinkingLevel: vi.fn(),
    getAvailableThinkingLevels: () => ['off', 'high'],
    setSessionName: vi.fn(),
    setAutoCompactionEnabled: vi.fn(),
    setActiveToolsByName: vi.fn(),
    getAllTools: () => [
      { name: 'read', description: 'Read files' },
      { name: 'extension_x', description: 'Extension' }
    ],
    getActiveToolNames: () => ['read'],
    getContextUsage: () => ({ tokens: 64, contextWindow: 128, percent: 50 }),
    getSessionStats: () => ({
      sessionId: 'session-1',
      totalMessages: 4,
      tokens: { input: 10, output: 5, cacheRead: 1, cacheWrite: 0, total: 16 }
    }),
    steer: vi.fn(),
    followUp: vi.fn(),
    dispose: vi.fn()
  }
}

function createManager(): PiSessionManagerLike {
  return {
    getCwd: () => '/tmp/project',
    getSessionFile: () => '/tmp/session.jsonl',
    getSessionId: () => 'session-1',
    getSessionName: () => 'Adapter test',
    getEntries: () => [],
    getEntry: () => undefined,
    getHeader: () => null,
    getLeafId: () => null,
    getBranch: () => [],
    getSessionDir: () => '/tmp',
    isPersisted: () => true,
    newSession: vi.fn(),
    createBranchedSession: vi.fn()
  }
}

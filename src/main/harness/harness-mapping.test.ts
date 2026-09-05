import { describe, expect, it, vi } from 'vitest'
import type { AgentSessionLike, PiSessionManagerLike } from '../agent/pi-sdk'
import type { AgentStateSnapshot } from '@shared/types/workspace'
import { detectHarnessCapabilities, getThinkingOptions } from './harness-capabilities'
import { mapAgentEvent } from './harness-events'
import { mapHarnessSession } from './harness-session'
import { mapHarnessState } from './harness-state'

describe('Harness mappings', () => {
  it('detects supported Pi capabilities without assuming optional APIs', () => {
    const session = createSession()
    expect(detectHarnessCapabilities(session)).toEqual({
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
    })
    expect(getThinkingOptions(session)).toEqual(['off', 'low', 'high'])

    session.steer = undefined
    session.abortCompaction = undefined
    session.getSessionStats = undefined
    expect(detectHarnessCapabilities(session)).toMatchObject({ steering: false, stats: false })
  })

  it('maps live state and derives missing context percent from real token values', () => {
    const snapshot = createSnapshot()
    snapshot.contextUsage = { tokens: 64_000, contextWindow: 128_000, percent: null }
    const capabilities = detectHarnessCapabilities(createSession())
    const state = mapHarnessState(
      snapshot,
      capabilities,
      [{ name: 'read', description: 'Read', active: true }],
      ['off', 'high']
    )

    expect(state.context).toEqual({ tokens: 64_000, contextWindow: 128_000, percent: 50 })
    expect(state.queue).toEqual({
      pendingMessages: 2,
      steering: ['steer'],
      followUp: ['later']
    })
    expect(state.runtime.status).toBe('running')
  })

  it('maps only inspectable event metadata and omits tool arguments and thinking text', () => {
    expect(
      mapAgentEvent({
        type: 'tool_execution_start',
        toolName: 'read',
        args: { path: '/secret' }
      })
    ).toEqual([expect.objectContaining({ type: 'tool.started', toolName: 'read' })])
    expect(mapAgentEvent({ type: 'message_update', thinking: 'private reasoning' })).toEqual([])
    expect(mapAgentEvent({ type: 'queue_update', steering: ['a'], followUp: ['b', 'c'] })).toEqual([
      expect.objectContaining({ type: 'queue.changed', steering: 1, followUp: 2 })
    ])
    expect(
      mapAgentEvent({ type: 'prompt_done', success: false, errorMessage: 'Request failed' })
    ).toEqual([expect.objectContaining({ type: 'runtime.error', message: 'Request failed' })])
  })

  it('maps Pi SessionManager entries to a content-free session tree DTO', () => {
    const session = createSession()
    session.sessionManager.getEntries = () => [
      {
        id: 'entry-1',
        parentId: null,
        type: 'message',
        timestamp: '2026-08-28T00:00:00.000Z',
        message: { role: 'user', content: 'not exposed' }
      }
    ]
    session.sessionManager.getBranch = session.sessionManager.getEntries
    session.sessionManager.getLeafId = () => 'entry-1'

    expect(mapHarnessSession(session)).toEqual({
      sessionId: 'session-1',
      name: 'Harness test',
      persisted: true,
      leafId: 'entry-1',
      entries: [
        {
          id: 'entry-1',
          parentId: null,
          type: 'message',
          role: 'user',
          timestamp: '2026-08-28T00:00:00.000Z',
          active: true
        }
      ]
    })
  })

  it('returns base session metadata when optional tree getters fail', () => {
    const session = createSession()
    session.sessionManager.getEntries = () => {
      throw new Error('unsupported')
    }
    session.sessionManager.getBranch = () => {
      throw new Error('unsupported')
    }
    session.sessionManager.getLeafId = () => {
      throw new Error('unsupported')
    }

    expect(mapHarnessSession(session)).toEqual({
      sessionId: 'session-1',
      name: 'Harness test',
      persisted: true,
      leafId: null,
      entries: []
    })
  })
})

function createSnapshot(): AgentStateSnapshot {
  return {
    sessionId: 'session-1',
    sessionFile: '/tmp/session.jsonl',
    status: 'running',
    isStreaming: true,
    isPromptRunning: true,
    isBashRunning: false,
    isCompacting: false,
    autoCompactionEnabled: true,
    model: { provider: 'anthropic', id: 'sonnet' },
    thinkingLevel: 'high',
    contextUsage: { tokens: 10, contextWindow: 100, percent: 10 },
    pendingMessageCount: 2,
    queuedMessages: { steering: ['steer'], followUp: ['later'] }
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
    getAvailableThinkingLevels: () => ['off', 'low', 'high'],
    setSessionName: vi.fn(),
    setAutoCompactionEnabled: vi.fn(),
    setActiveToolsByName: vi.fn(),
    getAllTools: () => [{ name: 'read', description: 'Read' }],
    getActiveToolNames: () => ['read'],
    getContextUsage: () => ({ tokens: 10, contextWindow: 100, percent: 10 }),
    getSessionStats: () => ({ sessionId: 'session-1' }),
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
    getSessionName: () => 'Harness test',
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

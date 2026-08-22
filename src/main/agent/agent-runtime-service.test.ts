import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionLike, PiSessionManagerLike } from './pi-sdk'

const loadPiCodingAgent = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({ BrowserWindow: class BrowserWindow {} }))
vi.mock('./pi-sdk', () => ({ loadPiCodingAgent }))

import { AgentRuntimeService, AgentSessionWrapper } from './agent-runtime-service'
import type { SessionService } from '../sessions/session-service'

describe('AgentRuntimeService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends the initial message without exposing an unpersisted JSONL path', async () => {
    const manager = createSessionManager()
    const inner = createAgentSession(manager)
    const cachePath = vi.fn()
    loadPiCodingAgent.mockResolvedValue({
      SessionManager: { create: () => manager },
      createAgentSessionServices: async () => ({}),
      createAgentSessionFromServices: async () => ({ session: inner }),
      getAgentDir: () => '/tmp/agent'
    })
    const sessions = {
      cachePath,
      invalidate: vi.fn(),
      resolvePath: vi.fn()
    } as unknown as SessionService

    const result = await new AgentRuntimeService(sessions).start({
      cwd: '/tmp/project',
      message: 'hello'
    })

    expect(result).toEqual({ sessionId: 'session-new', cwd: '/tmp/project' })
    expect(inner.prompt).toHaveBeenCalledWith('hello', expect.objectContaining({ source: 'rpc' }))
    expect(cachePath).not.toHaveBeenCalled()
  })

  it('treats a short-session compaction as a normal no-op', async () => {
    const inner = createAgentSession(createSessionManager())
    inner.compact = vi.fn().mockRejectedValue(new Error('Nothing to compact (session too small)'))

    const result = await new AgentSessionWrapper(inner).send({ type: 'compact' })

    expect(result).toEqual({ cancelled: true, reason: 'session-too-small' })
  })
})

function createSessionManager(): PiSessionManagerLike {
  return {
    getCwd: () => '/tmp/project',
    getSessionFile: () => '/tmp/deferred.jsonl',
    getSessionId: () => 'session-new',
    getSessionName: () => undefined,
    getEntries: () => [],
    getEntry: () => undefined,
    getHeader: () => null,
    getLeafId: () => null,
    getBranch: () => [],
    getSessionDir: () => '/tmp',
    isPersisted: () => true,
    newSession: () => undefined,
    createBranchedSession: () => null
  }
}

function createAgentSession(manager: PiSessionManagerLike): AgentSessionLike {
  const prompt = vi.fn(async (_message: string, options?: Record<string, unknown>) => {
    const preflightResult = options?.preflightResult as ((success: boolean) => void) | undefined
    preflightResult?.(true)
  })
  return {
    sessionId: 'session-new',
    sessionFile: '/tmp/deferred.jsonl',
    sessionManager: manager,
    isStreaming: false,
    isBashRunning: false,
    isCompacting: false,
    autoCompactionEnabled: true,
    model: { id: 'model', provider: 'provider' },
    agent: { state: { thinkingLevel: 'off' } },
    modelRuntime: { getModel: () => undefined, refresh: async () => undefined },
    subscribe: () => () => undefined,
    prompt,
    abort: async () => undefined,
    compact: async () => undefined,
    navigateTree: async () => ({ cancelled: false }),
    setModel: async () => undefined,
    setThinkingLevel: () => undefined,
    setSessionName: () => undefined,
    setAutoCompactionEnabled: () => undefined,
    setActiveToolsByName: () => undefined,
    getAllTools: () => [],
    getActiveToolNames: () => [],
    getContextUsage: () => null,
    dispose: () => undefined
  }
}

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

  it('injects workspace context into the Pi system prompt', async () => {
    const manager = createSessionManager()
    const inner = createAgentSession(manager)
    loadPiCodingAgent.mockResolvedValue({
      SessionManager: { create: () => manager },
      createAgentSessionServices: async () => ({}),
      createAgentSessionFromServices: async () => ({ session: inner }),
      getAgentDir: () => '/tmp/agent'
    })
    const sessions = {
      cachePath: vi.fn(),
      invalidate: vi.fn(),
      resolvePath: vi.fn()
    } as unknown as SessionService

    await new AgentRuntimeService(sessions, {
      getPrompt: () =>
        '--- BEGIN PI-HARNESS WORKSPACE ---\nMain Project\n--- END PI-HARNESS WORKSPACE ---'
    }).start({ cwd: '/tmp/project' })

    expect(inner.agent.state?.systemPrompt).toContain('PI-HARNESS WORKSPACE')
    expect(inner.agent.state?.systemPrompt).toContain('Main Project')
  })

  it('refreshes session project context before every prompt', async () => {
    const inner = createAgentSession(createSessionManager())
    inner.agent.state!.systemPrompt = 'Host prompt'
    const wrapper = new AgentSessionWrapper(inner)
    let project = 'Project A'
    wrapper.setWorkspacePromptProvider(
      () => `--- BEGIN PI-HARNESS WORKSPACE ---\n${project}\n--- END PI-HARNESS WORKSPACE ---`
    )

    project = 'Project B'
    await wrapper.send({ type: 'prompt', message: 'continue' })

    expect(inner.agent.state?.systemPrompt).toContain('Project B')
    expect(inner.agent.state?.systemPrompt).not.toContain('Project A')
  })

  it('treats a short-session compaction as a normal no-op', async () => {
    const inner = createAgentSession(createSessionManager())
    inner.compact = vi.fn().mockRejectedValue(new Error('Nothing to compact (session too small)'))

    const result = await new AgentSessionWrapper(inner).send({ type: 'compact' })

    expect(result).toEqual({ cancelled: true, reason: 'session-too-small' })
  })

  it('keeps extension tools for coding presets and allows exact Harness selections', async () => {
    const inner = createAgentSession(createSessionManager())
    inner.getAllTools = () => [
      { name: 'read', description: 'Read' },
      { name: 'extension_x', description: 'Extension' }
    ]
    const wrapper = new AgentSessionWrapper(inner)

    await wrapper.send({ type: 'set_tools', toolNames: ['read'] })
    expect(inner.setActiveToolsByName).toHaveBeenLastCalledWith(['read', 'extension_x'])

    await wrapper.send({
      type: 'set_tools',
      toolNames: ['read'],
      preserveExtensionTools: false
    })
    expect(inner.setActiveToolsByName).toHaveBeenLastCalledWith(['read'])
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
    setActiveToolsByName: vi.fn(),
    getAllTools: () => [],
    getActiveToolNames: () => [],
    getContextUsage: () => null,
    dispose: () => undefined
  }
}

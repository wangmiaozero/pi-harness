import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { PiSwitchAPI } from '@shared/ipc/api-types'
import { useAgentStore } from './agent'
import { useSessionStore } from './sessions'

describe('agent store new-session handshake', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    delete window.piSwitch
  })

  it('registers the session id before sending the first prompt', async () => {
    const start = vi.fn().mockResolvedValue({ sessionId: 'session-new', cwd: '/code/project' })
    const prompt = vi.fn().mockResolvedValue(null)
    window.piSwitch = {
      agent: { start, prompt }
    } as unknown as PiSwitchAPI

    const agent = useAgentStore()
    const sessions = useSessionStore()
    const sessionId = await agent.send(null, '/code/project', 'hello', 'default')

    expect(sessionId).toBe('session-new')
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: '/code/project', toolNames: expect.any(Array) })
    )
    expect(start.mock.calls[0]?.[0]).not.toHaveProperty('message')
    expect(prompt).toHaveBeenCalledWith({ sessionId: 'session-new', message: 'hello' })
    expect(sessions.items[0]).toMatchObject({ id: 'session-new', transient: true })
  })

  it('applies an explicit thinking level when constructing a new session', async () => {
    const start = vi.fn().mockResolvedValue({ sessionId: 'session-new', cwd: '/code/project' })
    const prompt = vi.fn().mockResolvedValue(null)
    window.piSwitch = {
      agent: { start, prompt }
    } as unknown as PiSwitchAPI

    const agent = useAgentStore()
    agent.thinkingLevel = 'high'
    await agent.send(null, '/code/project', 'hello', 'default')

    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: '/code/project', thinkingLevel: 'high' })
    )
  })

  it('sends an image-only prompt and keeps the image in the optimistic message', async () => {
    const start = vi.fn().mockResolvedValue({ sessionId: 'session-image', cwd: '/code/project' })
    const prompt = vi.fn().mockResolvedValue(null)
    window.piSwitch = {
      agent: { start, prompt }
    } as unknown as PiSwitchAPI

    const image = { type: 'image' as const, data: 'TQ==', mimeType: 'image/png' }
    const agent = useAgentStore()
    const sessions = useSessionStore()
    await agent.send(null, '/code/project', '', 'default', [image])

    expect(prompt).toHaveBeenCalledWith({
      sessionId: 'session-image',
      message: '',
      images: [image]
    })
    expect(sessions.items[0]?.firstMessage).toBe('[image]')
    expect(agent.messages[0]).toMatchObject({
      role: 'user',
      content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png' } }]
    })
  })

  it('keeps auto as a UI default without sending an invalid SDK thinking level', async () => {
    const command = vi.fn().mockResolvedValue(null)
    window.piSwitch = { agent: { command } } as unknown as PiSwitchAPI

    const agent = useAgentStore()
    await agent.setThinking('session-1', 'auto')

    expect(agent.thinkingLevel).toBe('auto')
    expect(command).not.toHaveBeenCalled()
  })

  it('keeps explicit composer selections stable across runtime reconciliation and reload', async () => {
    let runtimeThinking = 'off'
    let runtimeTools = toolEntries(['read', 'bash', 'edit', 'write'])
    const command = vi
      .fn()
      .mockImplementation((_id: string, input: { type: string; toolNames?: string[] }) => {
        if (input.type === 'get_tools') return runtimeTools
        if (input.type === 'set_tools') {
          runtimeTools = toolEntries(input.toolNames ?? [])
          return null
        }
        if (input.type === 'get_session_stats') return {}
        return null
      })
    window.piSwitch = {
      sessions: { get: vi.fn().mockResolvedValue(sessionDetail('off')) },
      agent: {
        state: vi.fn(() =>
          Promise.resolve({
            thinkingLevel: runtimeThinking,
            isStreaming: false,
            isPromptRunning: false
          })
        ),
        running: vi.fn().mockResolvedValue([]),
        command
      }
    } as unknown as PiSwitchAPI

    const agent = useAgentStore()
    await agent.load('session-1')
    await agent.setThinking('session-1', 'high')
    await agent.setTools('session-1', 'read-only')

    runtimeThinking = 'minimal'
    runtimeTools = toolEntries(['read', 'bash', 'edit', 'write'])
    await agent.reconcile('session-1')
    await agent.load('session-1')

    expect(agent.thinkingLevel).toBe('high')
    expect(agent.activePreset()).toBe('read-only')

    await agent.setThinking('session-1', 'auto')
    runtimeThinking = 'off'
    await agent.reconcile('session-1')
    expect(agent.thinkingLevel).toBe('auto')
  })

  it('reapplies composer selections when an existing session runtime is restarted', async () => {
    const start = vi.fn().mockResolvedValue({ sessionId: 'session-1', cwd: '/code/project' })
    const prompt = vi.fn().mockResolvedValue(null)
    const command = vi
      .fn()
      .mockImplementation((_id: string, input: { type: string; toolNames?: string[] }) => {
        if (input.type === 'get_tools') return toolEntries(input.toolNames ?? [])
        return null
      })
    window.piSwitch = {
      agent: {
        state: vi.fn().mockResolvedValue(null),
        start,
        prompt,
        command
      }
    } as unknown as PiSwitchAPI

    const agent = useAgentStore()
    await agent.setThinking('session-1', 'high')
    await agent.setTools('session-1', 'read-only')
    await agent.send('session-1', '/code/project', 'hello', 'default')

    expect(start).toHaveBeenCalledWith({
      sessionId: 'session-1',
      toolNames: ['read', 'grep', 'find', 'ls'],
      thinkingLevel: 'high'
    })
    expect(prompt).toHaveBeenCalledWith({ sessionId: 'session-1', message: 'hello' })
  })

  it('loads SDK session stats for the chat toolbar', async () => {
    window.piSwitch = {
      sessions: {
        get: vi.fn().mockResolvedValue({
          sessionId: 'session-1',
          filePath: '/tmp/session-1.jsonl',
          info: { id: 'session-1', name: 'Demo' },
          leafId: 'leaf-1',
          totalActiveMs: 4200,
          context: {
            messages: [{ role: 'user', content: 'hello' }],
            entryIds: ['leaf-1'],
            entryParents: { 'leaf-1': null },
            thinkingLevel: 'medium',
            model: null
          }
        })
      },
      agent: {
        state: vi.fn().mockResolvedValue(null),
        running: vi.fn().mockResolvedValue([]),
        command: vi.fn().mockImplementation((_id: string, command: { type: string }) => {
          if (command.type === 'get_tools') return []
          return {
            sessionId: 'session-1',
            sessionFile: '/tmp/session-1.jsonl',
            sessionName: 'Demo',
            userMessages: 1,
            assistantMessages: 1,
            toolCalls: 0,
            toolResults: 0,
            totalMessages: 2,
            tokens: { input: 1433, output: 107, cacheRead: 0, cacheWrite: 0, total: 1540 },
            cost: 0.01
          }
        })
      }
    } as unknown as PiSwitchAPI

    const agent = useAgentStore()
    await agent.load('session-1')

    expect(agent.sessionStats).toMatchObject({
      sessionId: 'session-1',
      sessionName: 'Demo',
      totalActiveMs: 4200,
      tokens: { input: 1433, output: 107, total: 1540 }
    })
  })

  it('signals completion once the outer prompt settles, not on intermediate agent_end events', async () => {
    let onAgentEvent: ((payload: unknown) => void) | undefined
    window.piSwitch = {
      on: vi.fn((name: string, listener: (payload: unknown) => void) => {
        if (name === 'agent-event') onAgentEvent = listener
        return () => undefined
      }),
      agent: {
        start: vi.fn().mockResolvedValue({ sessionId: 'session-new', cwd: '/code/project' }),
        prompt: vi.fn().mockResolvedValue(null),
        state: vi.fn().mockResolvedValue(null),
        running: vi.fn().mockResolvedValue([])
      }
    } as unknown as PiSwitchAPI

    const agent = useAgentStore()
    agent.setupListeners()
    await agent.send(null, '/code/project', 'hello', 'default')

    onAgentEvent?.({ sessionId: 'session-new', event: { type: 'agent_end' } })
    expect(agent.completionCount).toBe(0)

    onAgentEvent?.({ sessionId: 'session-new', event: { type: 'prompt_done' } })
    expect(agent.completionCount).toBe(1)
  })
})

function sessionDetail(thinkingLevel: string) {
  return {
    sessionId: 'session-1',
    filePath: '/tmp/session-1.jsonl',
    info: { id: 'session-1', name: 'Demo' },
    leafId: 'leaf-1',
    totalActiveMs: 0,
    context: {
      messages: [],
      entryIds: [],
      entryParents: {},
      thinkingLevel,
      model: null
    }
  }
}

function toolEntries(activeNames: string[]) {
  const active = new Set(activeNames)
  return ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'].map((name) => ({
    name,
    description: name,
    active: active.has(name)
  }))
}

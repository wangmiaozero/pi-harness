import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionLike, PiSessionManagerLike } from './pi-sdk'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const loadPiCodingAgent = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({ BrowserWindow: class BrowserWindow {} }))
vi.mock('./pi-sdk', () => ({ loadPiCodingAgent }))

import { AgentRuntimeService, AgentSessionWrapper } from './agent-runtime-service'
import type { SessionService } from '../sessions/session-service'

describe('AgentRuntimeService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('refuses a verified OpenCode reference when native registration is missing instead of choosing a fallback', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-no-fallback-'))
    const file = path.join(dir, 'state.json')
    await fs.writeFile(
      file,
      JSON.stringify({
        schemaVersion: 2,
        enabled: true,
        authMode: 'inference',
        hasCredential: true,
        refreshedAt: Date.now(),
        authorizedModels: ['big-pickle'],
        allowedPaidModels: [],
        models: [
          {
            id: 'big-pickle',
            available: true,
            api: 'openai-completions',
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            price: 'free',
            status: 'ready',
            streaming: 'verified',
            tools: 'verified',
            contextWindow: 200000,
            maxTokens: 32000
          }
        ]
      })
    )
    vi.stubEnv('PI_HARNESS_OPENCODE_STATE', file)
    const createSession = vi.fn()
    loadPiCodingAgent.mockResolvedValue(
      fakeSdk({
        SessionManager: { create: () => createSessionManager() },
        createAgentSessionServices: async () => ({ modelRuntime: { getModel: () => undefined } }),
        createAgentSessionFromServices: createSession,
        getAgentDir: () => '/tmp/agent'
      })
    )
    try {
      const runtime = new AgentRuntimeService({ invalidate: vi.fn() } as never)
      await expect(
        runtime.start({ cwd: '/tmp/project', provider: 'opencode-free', modelId: 'big-pickle' })
      ).rejects.toThrow('select another model explicitly')
      expect(createSession).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllEnvs()
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('sends the initial message without exposing an unpersisted JSONL path', async () => {
    const manager = createSessionManager()
    const inner = createAgentSession(manager)
    const cachePath = vi.fn()
    loadPiCodingAgent.mockResolvedValue(
      fakeSdk({
        SessionManager: { create: () => manager },
        createAgentSessionServices: async () => ({}),
        createAgentSessionFromServices: async () => ({ session: inner }),
        getAgentDir: () => '/tmp/agent'
      })
    )
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
    const createServices = vi.fn(async (_options: Record<string, unknown>) => ({}))
    loadPiCodingAgent.mockResolvedValue(
      fakeSdk({
        SessionManager: { create: () => manager },
        createAgentSessionServices: createServices,
        createAgentSessionFromServices: async () => ({ session: inner }),
        getAgentDir: () => '/tmp/agent'
      })
    )
    const sessions = {
      cachePath: vi.fn(),
      invalidate: vi.fn(),
      resolvePath: vi.fn()
    } as unknown as SessionService

    await new AgentRuntimeService(sessions, {
      getPrompt: () =>
        '--- BEGIN PI-HARNESS WORKSPACE ---\nMain Project\n--- END PI-HARNESS WORKSPACE ---'
    }).start({ cwd: '/tmp/project' })

    const options = createServices.mock.calls[0][0] as {
      resourceLoaderOptions: { appendSystemPromptOverride: (base: string[]) => string[] }
    }
    const prompt = options.resourceLoaderOptions
      .appendSystemPromptOverride(['Native context'])
      .join('\n')
    expect(prompt).toContain('Native context')
    expect(prompt).toContain('PI-HARNESS WORKSPACE')
    expect(prompt).toContain('Main Project')
  })

  it('awaits native extension binding and cleans up when it fails', async () => {
    const inner = createAgentSession(createSessionManager())
    inner.bindExtensions = vi.fn().mockRejectedValue(new Error('fixture binding failure'))
    const shutdown = vi.spyOn(inner.extensionRunner, 'emit')
    const dispose = vi.spyOn(inner, 'dispose')
    loadPiCodingAgent.mockResolvedValue(
      fakeSdk({
        SessionManager: { create: () => inner.sessionManager },
        createAgentSessionServices: async () => ({}),
        createAgentSessionFromServices: async () => ({ session: inner }),
        getAgentDir: () => '/tmp/agent'
      })
    )
    const runtime = new AgentRuntimeService({ invalidate: vi.fn() } as unknown as SessionService)
    await expect(runtime.start({ cwd: '/tmp/project' })).rejects.toThrow('fixture binding failure')
    expect(shutdown).toHaveBeenCalledWith({ type: 'session_shutdown', reason: 'quit' })
    expect(dispose).toHaveBeenCalledOnce()
    expect(runtime.get(inner.sessionId)).toBeUndefined()
  })

  it('settles in-flight startup during shutdown and refuses subsequent starts', async () => {
    const inner = createAgentSession(createSessionManager())
    let bound!: () => void
    inner.bindExtensions = vi.fn(() => new Promise<void>((resolve) => (bound = resolve)))
    const dispose = vi.spyOn(inner, 'dispose')
    loadPiCodingAgent.mockResolvedValue(
      fakeSdk({
        SessionManager: { create: () => inner.sessionManager },
        createAgentSessionServices: async () => ({}),
        createAgentSessionFromServices: async () => ({ session: inner }),
        getAgentDir: () => '/tmp/agent'
      })
    )
    const runtime = new AgentRuntimeService({ invalidate: vi.fn() } as unknown as SessionService)
    const starting = runtime.start({ cwd: '/tmp/project' })
    const rejected = expect(starting).rejects.toThrow('shutting down')
    await vi.waitFor(() => expect(inner.bindExtensions).toHaveBeenCalledOnce())
    const stopping = runtime.shutdownAll()
    bound()
    await rejected
    await stopping
    expect(dispose).toHaveBeenCalledOnce()
    await expect(runtime.start({ cwd: '/tmp/project' })).rejects.toThrow('shutting down')
  })

  it('adds architecture retrieval through Native Pi custom tools without replacing its prompt', async () => {
    const manager = createSessionManager()
    const inner = createAgentSession(manager)
    const customTools = vi.fn(async () => [
      {
        name: 'get_project_architecture',
        label: 'Architecture',
        description: 'Read architecture',
        parameters: { type: 'object' },
        execute: async () => ({ content: [], details: {} })
      }
    ])
    const create = vi.fn(async () => ({ session: inner }))
    const services = vi.fn(async (_options: Record<string, unknown>) => ({}))
    loadPiCodingAgent.mockResolvedValue(
      fakeSdk({
        SessionManager: { create: () => manager },
        createAgentSessionServices: services,
        createAgentSessionFromServices: create,
        getAgentDir: () => '/tmp/agent'
      })
    )
    const runtime = new AgentRuntimeService({ invalidate: vi.fn() } as unknown as SessionService, {
      customTools,
      architectureHint: async () => 'Source-backed architecture is available.'
    })
    await runtime.start({ cwd: '/tmp/project' })
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        customTools: expect.arrayContaining([
          expect.objectContaining({ name: 'get_project_architecture' })
        ])
      })
    )
    const options = services.mock.calls[0][0] as unknown as {
      resourceLoaderOptions: { appendSystemPromptOverride: (base: string[]) => string[] }
    }
    const prompt = options.resourceLoaderOptions.appendSystemPromptOverride([
      'Native project instructions'
    ])
    expect(prompt[0]).toContain('Native project instructions')
    expect(prompt[0]).toContain('PI-HARNESS FILE INTEGRITY')
    expect(prompt[1]).toBe('Source-backed architecture is available.')
    await runtime.shutdownAll()
  })

  it('requires a real tool call for explicit file-writing requests on compatible providers', async () => {
    const inner = createAgentSession(createSessionManager())
    Object.assign(inner, {
      model: { id: 'step-3.7-flash', provider: 'step-plan', api: 'openai-responses' }
    })
    inner.getActiveToolNames = () => ['read', 'write', 'edit']
    inner.agent.onPayload = vi.fn((payload: unknown) => ({
      ...(payload as Record<string, unknown>),
      extensionApplied: true
    }))
    let outgoingPayload: unknown
    inner.prompt = vi.fn(async (_message: string, options?: Record<string, unknown>) => {
      outgoingPayload = await inner.agent.onPayload?.(
        { tools: [{ type: 'function', function: { name: 'write' } }] },
        inner.model!
      )
      const preflightResult = options?.preflightResult as
        ((disposition: string) => void) | undefined
      preflightResult?.('started')
    })

    await new AgentSessionWrapper(inner).send({
      type: 'prompt',
      message: '在本目录生成一个 pelican-bike.html 文件'
    })

    expect(outgoingPayload).toMatchObject({
      tool_choice: 'required',
      extensionApplied: true
    })
  })

  it('does not force tool use for an ordinary conversational prompt', async () => {
    const inner = createAgentSession(createSessionManager())
    Object.assign(inner, {
      model: { id: 'step-3.7-flash', provider: 'step-plan', api: 'openai-responses' }
    })
    inner.getActiveToolNames = () => ['read', 'write', 'edit']
    let outgoingPayload: unknown
    inner.prompt = vi.fn(async (_message: string, options?: Record<string, unknown>) => {
      outgoingPayload = await inner.agent.onPayload?.(
        { tools: [{ type: 'function', function: { name: 'write' } }] },
        inner.model!
      )
      const preflightResult = options?.preflightResult as
        ((disposition: string) => void) | undefined
      preflightResult?.('started')
    })

    await new AgentSessionWrapper(inner).send({ type: 'prompt', message: '解释一下 SVG viewBox' })

    expect(outgoingPayload).not.toHaveProperty('tool_choice')
  })
  it.each([
    {
      compat: { thinkingFormat: 'deepseek' },
      thinking: { type: 'enabled' },
      toolChoice: 'required',
      expected: undefined
    },
    {
      compat: undefined,
      baseUrl: 'https://api.deepseek.com/v1',
      thinking: undefined,
      toolChoice: { type: 'function', function: { name: 'write' } },
      expected: undefined
    },
    {
      compat: { thinkingFormat: 'deepseek' },
      thinking: { type: 'disabled' },
      expected: 'required'
    },
    {
      compat: { thinkingFormat: 'deepseek' },
      thinking: undefined,
      effort: 'none',
      expected: 'required'
    },
    { compat: { thinkingFormat: 'openai' }, thinking: { type: 'enabled' }, expected: 'required' }
  ])(
    'keeps file tools available without forcing a choice rejected by thinking mode: %j',
    async ({ compat, baseUrl, thinking, effort, toolChoice, expected }) => {
      const inner = createAgentSession(createSessionManager())
      Object.assign(inner, {
        model: {
          id: 'configured-model',
          provider: 'custom-provider',
          api: 'openai-completions',
          compat,
          baseUrl
        }
      })
      inner.getActiveToolNames = () => ['read', 'write', 'edit']
      const input = {
        tools: [{ type: 'function', function: { name: 'write' } }],
        thinking,
        reasoning_effort: effort,
        ...(toolChoice ? { tool_choice: toolChoice } : {})
      }
      let outgoing: unknown
      inner.prompt = vi.fn(async (_message, options) => {
        outgoing = await inner.agent.onPayload?.(input, inner.model!)
        ;(options?.preflightResult as (accepted: boolean) => void)?.(true)
      })
      await new AgentSessionWrapper(inner).send({
        type: 'prompt',
        message: 'Create a file named example.html'
      })
      expect(outgoing).toMatchObject({ tools: input.tools, thinking, reasoning_effort: effort })
      if (expected) expect(outgoing).toHaveProperty('tool_choice', expected)
      else expect(outgoing).not.toHaveProperty('tool_choice')
    }
  )
  it('uses only the current instruction for tool enforcement when the prompt includes history', async () => {
    const inner = createAgentSession(createSessionManager())
    Object.assign(inner, {
      model: { id: 'model', provider: 'provider', api: 'openai-completions' }
    })
    inner.getActiveToolNames = () => ['read', 'write', 'edit']
    let outgoing: unknown
    inner.prompt = vi.fn(async (_message, options) => {
      outgoing = await inner.agent.onPayload?.(
        { tools: [{ type: 'function', function: { name: 'write' } }] },
        inner.model!
      )
      ;(options?.preflightResult as (accepted: boolean) => void)?.(true)
    })
    const wrapper = new AgentSessionWrapper(inner)
    await wrapper.send({
      type: 'prompt',
      message: 'Historical request: Create a file named example.html. Current instruction: hi',
      toolEnforcementText: 'hi'
    })
    expect(outgoing).not.toHaveProperty('tool_choice')
    await wrapper.send({
      type: 'prompt',
      message: 'Quoted conversation context',
      toolEnforcementText: 'Create a file named new.html'
    })
    expect(outgoing).toHaveProperty('tool_choice', 'required')
  })

  it('persists externally generated images with Pi-native message content', async () => {
    const manager = createSessionManager()
    manager.appendMessage = vi
      .fn()
      .mockReturnValueOnce('user-entry')
      .mockReturnValueOnce('image-entry')
    const inner = createAgentSession(manager)
    inner.refreshContext = vi.fn()

    const result = await new AgentSessionWrapper(inner).send({
      type: 'append_external_image_result',
      prompt: 'draw a lighthouse',
      provider: 'step-plan',
      modelId: 'step-image-edit-2',
      sourceImages: [],
      resultImage: { type: 'image', data: 'TQ==', mimeType: 'image/png' }
    })

    expect(result).toEqual({ userEntryId: 'user-entry', assistantEntryId: 'image-entry' })
    expect(manager.appendMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        role: 'user',
        content: [{ type: 'text', text: 'draw a lighthouse' }]
      })
    )
    expect(manager.appendMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        role: 'custom',
        customType: 'pi-harness-image-result',
        details: { provider: 'step-plan', model: 'step-image-edit-2' },
        content: [{ type: 'image', data: 'TQ==', mimeType: 'image/png' }]
      })
    )
    expect(inner.refreshContext).toHaveBeenCalled()
  })

  it('treats a short-session compaction as a normal no-op', async () => {
    const inner = createAgentSession(createSessionManager())
    inner.compact = vi.fn().mockRejectedValue(new Error('Nothing to compact (session too small)'))

    const result = await new AgentSessionWrapper(inner).send({ type: 'compact' })

    expect(result).toEqual({ cancelled: true, reason: 'session-too-small' })
  })

  it('turns a summarization quota failure into a recoverable AgentError', async () => {
    const inner = createAgentSession(createSessionManager())
    inner.compact = vi
      .fn()
      .mockRejectedValue(
        new Error(
          'Summarization failed: 429 {"error":{"code":"AccountQuotaExceeded","message":"You have exceeded the 5-hour usage quota. It will reset at 2026-09-19 11:23:11 +0800 CST.","param":"","type":"TooManyRequests"}}'
        )
      )

    await expect(new AgentSessionWrapper(inner).send({ type: 'compact' })).rejects.toMatchObject({
      code: 'AGENT_ERROR',
      recoverable: true,
      userMessage: expect.stringContaining('quota is exhausted until 2026-09-19 11:23:11')
    })
  })

  it('keeps extension tools for coding presets and allows exact Harness selections', async () => {
    const inner = createAgentSession(createSessionManager())
    inner.getActiveToolNames = () => ['read', 'extension_x']
    inner.getAllTools = () => [
      {
        name: 'read',
        description: 'Read',
        parameters: { type: 'object' },
        exposure: 'direct',
        sourceInfo: {
          source: 'custom',
          scope: 'temporary',
          origin: 'top-level',
          path: '/tmp/test-extension.ts'
        }
      },
      {
        name: 'extension_x',
        description: 'Extension',
        parameters: { type: 'object' },
        exposure: 'direct',
        sourceInfo: {
          source: 'custom',
          scope: 'temporary',
          origin: 'top-level',
          path: '/tmp/test-extension.ts'
        }
      }
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

    await wrapper.send({ type: 'set_tools', toolNames: ['read', 'grep', 'find', 'ls'] })
    expect(inner.setActiveToolsByName).toHaveBeenLastCalledWith(['read', 'grep', 'find', 'ls'])
    await wrapper.send({ type: 'set_tools', toolNames: [] })
    expect(inner.setActiveToolsByName).toHaveBeenLastCalledWith([])
  })

  it('restores only previously active extensions after a restricted tool preset', async () => {
    const inner = createAgentSession(createSessionManager())
    let active = ['read', 'extension_active']
    inner.getActiveToolNames = () => active
    inner.getAllTools = vi
      .fn()
      .mockReturnValue(
        ['read', 'extension_active', 'extension_disabled'].map((name) => ({
          name,
          description: name,
          parameters: { type: 'object' }
        }))
      )
    inner.setActiveToolsByName = vi.fn((names) => {
      active = [...names]
    })
    const wrapper = new AgentSessionWrapper(inner)
    await wrapper.send({ type: 'set_tools', toolNames: ['read', 'grep', 'find', 'ls'] })
    expect(active).toEqual(['read', 'grep', 'find', 'ls'])
    await wrapper.send({ type: 'set_tools', toolNames: [] })
    expect(active).toEqual([])
    await wrapper.send({ type: 'set_tools', toolNames: ['read', 'bash', 'edit', 'write'] })
    expect(active).toContain('extension_active')
    expect(active).not.toContain('extension_disabled')
    await wrapper.send({ type: 'set_tools', toolNames: [], preserveExtensionTools: false })
    await wrapper.send({ type: 'set_tools', toolNames: ['read', 'bash', 'edit', 'write'] })
    expect(active).not.toContain('extension_active')
  })

  it('rejects image prompts when the active model is text-only', async () => {
    const inner = createAgentSession(createSessionManager())
    const refresh = vi.fn(async () => undefined)
    Object.assign(inner, {
      modelRuntime: {
        refresh,
        getModel: () => ({ id: 'unlisted-vision-model', provider: 'provider', input: ['text'] })
      }
    })
    Object.assign(inner, {
      model: { id: 'unlisted-vision-model', provider: 'provider', input: ['text'] }
    })
    inner.setModel = vi.fn(async () => undefined)
    const image = { type: 'image', data: 'TQ==', mimeType: 'image/png' }

    const wrapper = new AgentSessionWrapper(inner)

    await expect(
      wrapper.send({
        type: 'prompt',
        message: 'describe',
        images: [image]
      })
    ).rejects.toThrow('Model does not support image input: provider/unlisted-vision-model')
    expect(refresh).toHaveBeenCalledWith({ allowNetwork: false })
    expect(inner.setModel).not.toHaveBeenCalled()
    expect(inner.prompt).not.toHaveBeenCalled()
    expect(wrapper.isRunning()).toBe(false)
  })

  it('cancels image preparation and waiting prompt admissions before native execution', async () => {
    const inner = createAgentSession(createSessionManager())
    const model = {
      id: 'fixture',
      provider: 'fixture',
      api: 'openai-completions',
      input: ['text', 'image']
    }
    let release!: () => void
    const refresh = vi.fn(() => new Promise<void>((resolve) => (release = resolve)))
    Object.assign(inner, { model, modelRuntime: { refresh, getModel: () => model } })
    const wrapper = new AgentSessionWrapper(inner)
    const first = wrapper.send({
      type: 'prompt',
      message: 'image',
      images: [{ type: 'image', mimeType: 'image/png', data: 'TQ==' }]
    })
    const firstRejected = expect(first).rejects.toThrow('Prompt cancelled before execution')
    const second = wrapper.send({ type: 'prompt', message: 'waiting' })
    const secondRejected = expect(second).rejects.toThrow('Prompt cancelled before execution')
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce())
    await wrapper.send({ type: 'abort' })
    release()
    await Promise.all([firstRejected, secondRejected])
    expect(inner.prompt).not.toHaveBeenCalled()
    wrapper.destroy()
  })

  it('forwards queued images when the active model declares image input', async () => {
    const inner = createAgentSession(createSessionManager())
    Object.assign(inner, { isStreaming: true })
    Object.assign(inner, {
      model: { id: 'multimodal', provider: 'provider', input: ['text', 'image'] }
    })
    inner.setModel = vi.fn(async () => undefined)
    inner.steer = vi.fn(async () => 'queued' as const)
    const image = { type: 'image', data: 'TQ==', mimeType: 'image/png' }

    await new AgentSessionWrapper(inner).send({
      type: 'steer',
      message: 'inspect',
      images: [image]
    })

    expect(inner.setModel).not.toHaveBeenCalled()
    expect(inner.steer).toHaveBeenCalledWith('inspect', [image])
  })

  it('applies current catalog image capability before sending to Pi', async () => {
    const inner = createAgentSession(createSessionManager())
    Object.assign(inner, {
      modelRuntime: {
        refresh: vi.fn(async () => undefined),
        getModel: () => ({
          id: 'glm-5.3-flash',
          provider: 'zhipuai-coding-plan',
          input: ['text']
        })
      }
    })
    Object.assign(inner, {
      model: {
        id: 'glm-5.3-flash',
        provider: 'zhipuai-coding-plan',
        input: ['text']
      }
    })
    inner.setModel = vi.fn(async () => undefined)
    const image = { type: 'image', data: 'TQ==', mimeType: 'image/png' }

    await new AgentSessionWrapper(inner).send({
      type: 'prompt',
      message: 'describe',
      images: [image]
    })

    expect(inner.setModel).toHaveBeenCalledWith(
      expect.objectContaining({ input: ['text', 'image'] })
    )
    expect(inner.prompt).toHaveBeenCalledWith(
      'describe',
      expect.objectContaining({ images: [image], source: 'rpc' })
    )
  })

  it('rejects image prompts when Pi image input is globally disabled', async () => {
    const inner = createAgentSession(createSessionManager())
    Object.assign(inner, { settingsManager: { getBlockImages: () => true } })
    const wrapper = new AgentSessionWrapper(inner)

    await expect(
      wrapper.send({
        type: 'prompt',
        message: 'describe',
        images: [{ type: 'image', data: 'TQ==', mimeType: 'image/png' }]
      })
    ).rejects.toThrow('Image input is disabled in Pi settings')
    expect(inner.prompt).not.toHaveBeenCalled()
    expect(wrapper.isRunning()).toBe(false)
  })

  it('reports a resolved assistant error as a failed prompt completion', async () => {
    const inner = createAgentSession(createSessionManager())
    let emitSdkEvent: ((event: { type: string; [key: string]: unknown }) => void) | undefined
    inner.subscribe = (listener) => {
      emitSdkEvent = (event) =>
        listener(event as import('@earendil-works/pi-coding-agent').AgentSessionEvent)
      return () => undefined
    }
    inner.prompt = vi.fn(async (_message: string, options?: Record<string, unknown>) => {
      const preflightResult = options?.preflightResult as
        ((disposition: string) => void) | undefined
      preflightResult?.('started')
      emitSdkEvent?.({
        type: 'message_end',
        message: {
          role: 'assistant',
          model: 'glm-5.3',
          provider: 'volcengine',
          content: [],
          stopReason: 'error',
          errorMessage: 'Model only supports text input'
        }
      })
    })
    const wrapper = new AgentSessionWrapper(inner)
    const events: Array<{ type: string; [key: string]: unknown }> = []
    wrapper.start()
    wrapper.onEvent((event) => events.push(event))

    await wrapper.send({ type: 'prompt', message: 'describe' })

    await vi.waitFor(() => {
      expect(events.at(-1)).toEqual({
        type: 'prompt_done',
        success: false,
        errorMessage: 'Model only supports text input'
      })
    })
  })

  it.each([
    { recovery: 'disabled', success: false },
    { recovery: 'failed', success: false },
    { recovery: 'succeeded', success: true }
  ])(
    'settles a truncated reply after native recovery is $recovery',
    async ({ recovery, success }) => {
      const inner = createAgentSession(createSessionManager())
      let emitSdkEvent!: (event: { type: string; [key: string]: unknown }) => void
      inner.subscribe = (listener) => {
        emitSdkEvent = (event) =>
          listener(event as import('@earendil-works/pi-coding-agent').AgentSessionEvent)
        return () => undefined
      }
      const events: Array<{ type: string; [key: string]: unknown }> = []
      inner.prompt = vi.fn(async (_message: string, options?: Record<string, unknown>) => {
        ;(options?.preflightResult as (disposition: string) => void)?.('started')
        emitSdkEvent({
          type: 'message_end',
          message: {
            role: 'assistant',
            stopReason: 'length',
            content: [{ type: 'thinking', thinking: 'Let' }]
          }
        })
        expect(events.some((event) => event.type === 'prompt_error')).toBe(false)
        if (recovery !== 'disabled') {
          emitSdkEvent({ type: 'compaction_start', reason: 'overflow' })
          emitSdkEvent({
            type: 'compaction_end',
            reason: 'overflow',
            aborted: false,
            willRetry: success,
            ...(success ? { result: {} } : { errorMessage: 'Context overflow recovery failed' })
          })
        }
        if (success) {
          emitSdkEvent({ type: 'agent_start' })
          emitSdkEvent({
            type: 'message_end',
            message: { role: 'assistant', stopReason: 'stop', content: [] }
          })
        }
        // Non-assistant messages must not erase the pending failure.
        emitSdkEvent({ type: 'message_end', message: { role: 'toolResult', content: [] } })
        emitSdkEvent({ type: 'agent_settled', aborted: false })
      })
      const wrapper = new AgentSessionWrapper(inner)
      wrapper.start()
      wrapper.onEvent((event) => events.push(event))
      try {
        await wrapper.send({ type: 'prompt', message: 'continue' })
        await vi.waitFor(() =>
          expect(events.at(-1)).toMatchObject({ type: 'prompt_done', success })
        )
        const errors = events.filter((event) => event.type === 'prompt_error')
        expect(errors).toHaveLength(success ? 0 : 1)
        if (!success) {
          expect(events.indexOf(errors[0])).toBeLessThan(
            events.findIndex((event) => event.type === 'agent_settled')
          )
        }
      } finally {
        wrapper.destroy()
      }
    }
  )

  it('throttles accumulated-message snapshots on streaming deltas', () => {
    vi.useFakeTimers()
    const inner = createAgentSession(createSessionManager())
    let emitSdkEvent: ((event: { type: string; [key: string]: unknown }) => void) | undefined
    inner.subscribe = (listener) => {
      emitSdkEvent = (event) =>
        listener(event as import('@earendil-works/pi-coding-agent').AgentSessionEvent)
      return () => undefined
    }

    const events: Array<{ type: string; message?: unknown }> = []
    const wrapper = new AgentSessionWrapper(inner)
    wrapper.start()
    wrapper.onEvent((event) => events.push(event as { type: string; message?: unknown }))

    const snapshot = () => ({
      role: 'assistant',
      model: 'model',
      provider: 'provider',
      content: [{ type: 'text', text: 'accumulated' }]
    })
    const delta = (text: string) => ({
      type: 'message_update',
      message: snapshot(),
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: text }
    })

    emitSdkEvent?.(delta('a'))
    emitSdkEvent?.(delta('b'))
    emitSdkEvent?.(delta('c'))

    const updates = events.filter((event) => event.type === 'message_update')
    expect(updates).toHaveLength(3)
    expect(updates[0].message).toMatchObject({ role: 'assistant' })
    expect(updates[1].message).toBeUndefined()
    expect(updates[2].message).toBeUndefined()

    // message_start / message_end always carry authoritative copies.
    emitSdkEvent?.({
      type: 'message_start',
      message: { role: 'assistant', model: 'model', provider: 'provider', content: [] }
    })
    emitSdkEvent?.({
      type: 'message_end',
      message: { role: 'assistant', model: 'model', provider: 'provider', content: [] }
    })
    const boundaries = events.filter(
      (event) => event.type === 'message_start' || event.type === 'message_end'
    )
    expect(boundaries).toHaveLength(2)
    expect(boundaries[0].message).toMatchObject({ role: 'assistant' })
    expect(boundaries[1].message).toMatchObject({ role: 'assistant' })

    // After the interval a new snapshot is relayed (mid-stream reload recovery).
    vi.advanceTimersByTime(250)
    emitSdkEvent?.(delta('d'))
    const recovered = events.filter((event) => event.type === 'message_update').at(-1)
    expect(recovered?.message).toMatchObject({ role: 'assistant' })

    vi.useRealTimers()
  })

  it('refreshes the model catalog before every explicit model switch', async () => {
    const inner = createAgentSession(createSessionManager())
    const model = { id: 'model', provider: 'provider', input: ['text', 'image'] as const }
    Object.assign(inner, {
      modelRuntime: {
        refresh: vi.fn(async () => undefined),
        getModel: () => ({ ...model, input: [...model.input] })
      }
    })
    inner.setModel = vi.fn(async () => undefined)

    await new AgentSessionWrapper(inner).send({
      type: 'set_model',
      provider: 'provider',
      modelId: 'model'
    })

    expect(inner.modelRuntime.refresh).toHaveBeenCalledWith({ allowNetwork: false })
    expect(inner.setModel).toHaveBeenCalledWith(expect.objectContaining({ input: model.input }))
  })

  it('resolves Ultra to the highest supported Pi level', async () => {
    const inner = createAgentSession(createSessionManager())
    inner.setThinkingLevel = vi.fn()
    inner.getAvailableThinkingLevels = () => ['off', 'high']

    await new AgentSessionWrapper(inner).send({ type: 'set_thinking_level', level: 'ultra' })
    expect(inner.setThinkingLevel).toHaveBeenCalledWith('high')

    inner.getAvailableThinkingLevels = () => ['off', 'high', 'max']
    await new AgentSessionWrapper(inner).send({ type: 'set_thinking_level', level: 'ultra' })
    expect(inner.setThinkingLevel).toHaveBeenLastCalledWith('max')
  })

  it('leaves compaction request policy to native extension lifecycle hooks', async () => {
    const inner = createAgentSession(createSessionManager())
    inner.agent.state!.thinkingLevel = 'max'
    inner.setThinkingLevel = vi.fn((level: string) => {
      Object.assign(inner.agent.state, { thinkingLevel: level })
    })
    inner.compact = vi.fn(async () => {
      expect(inner.agent.state?.thinkingLevel).toBe('max')
      return { tokensBefore: 12_000, summary: 'summary', firstKeptEntryId: 'entry' }
    })

    await new AgentSessionWrapper(inner).send({ type: 'compact' })
    expect(inner.setThinkingLevel).not.toHaveBeenCalled()
    expect(inner.agent.state?.thinkingLevel).toBe('max')
  })
})

function createSessionManager(): PiSessionManagerLike {
  return {
    buildSessionContext: () => ({ model: null, messages: [], thinkingLevel: 'off' }),
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
  } as unknown as PiSessionManagerLike
}

function createAgentSession(manager: PiSessionManagerLike): AgentSessionLike {
  const state: { thinkingLevel: import('@earendil-works/pi-agent-core').ThinkingLevel } = {
    thinkingLevel: 'off'
  }
  const prompt = vi.fn(async (_message: string, options?: Record<string, unknown>) => {
    const preflightResult = options?.preflightResult as ((disposition: string) => void) | undefined
    preflightResult?.('started')
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
    agent: { state },
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
    settingsManager: { getBlockImages: () => false },
    getAllTools: () => [],
    getActiveToolNames: () => [],
    getContextUsage: () => null,
    extensionRunner: { emit: async () => undefined },
    bindExtensions: async () => undefined,
    get thinkingLevel() {
      return state.thinkingLevel
    },
    getAvailableThinkingLevels: () => ['off', 'low', 'medium', 'high', 'xhigh', 'max'],
    dispose: () => undefined
  } as unknown as AgentSessionLike
}

function fakeSdk<T extends object>(module: T) {
  return {
    initTheme: vi.fn(),
    SettingsManager: {
      create: vi.fn(() => ({
        getDefaultProvider: () => undefined,
        getDefaultModel: () => undefined
      }))
    },
    createCodemodeExtension: () => () => undefined,
    createMcpExtension: () => () => undefined,
    createToolSearchExtension: () => () => undefined,
    AgentSessionRuntime: class {
      setBeforeSessionInvalidate() {}
    },
    ...module
  }
}

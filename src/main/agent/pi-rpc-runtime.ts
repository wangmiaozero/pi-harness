import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import type {
  AgentEvent,
  AgentStateSnapshot,
  StartAgentSessionInput
} from '@shared/types/workspace'
import type {
  HarnessForkResult,
  HarnessCapabilities,
  HarnessEvent,
  HarnessSessionInfo,
  HarnessStats,
  HarnessTool
} from '@shared/types/harness'
import { IPC_EVENT } from '@shared/ipc/channels'
import { getToolNamesForPreset } from '@shared/workspace/tool-presets'
import {
  toIpcAgentEvent,
  isRunningStateEvent,
  hasAssistantSnapshot
} from '@shared/workspace/agent-event-wire'
import { validateAgentImages } from '@shared/workspace/image-attachments'
import { inspectRuntimeError } from '@shared/workspace/runtime-error'
import type { HarnessAdapter, HarnessPromptOptions } from '../harness/harness-types'
import { mapHarnessState } from '../harness/harness-state'
import { mapAgentEvent } from '../harness/harness-events'
import type { SessionService } from '../sessions/session-service'
import type { RuntimeManager } from '../runtime/runtime-manager'
import { AgentError } from '../services/errors'
import { extractToolPath } from '../workspace/workspace-tool-guard'
import { PiRpcClient } from './pi-rpc-client'
import { DesktopBridge } from './desktop-bridge'
import { AgentEventBatcher } from './agent-event-batcher'
import { persistExternalImageResult, type AgentRuntimeService } from './agent-runtime-service'
import { loadPiCodingAgent } from './pi-sdk'

interface DesktopSnapshot {
  tools: HarnessTool[]
  contextUsage: AgentStateSnapshot['contextUsage']
  idle: boolean
  entries: Array<{
    id: string
    parentId: string | null
    type: string
    timestamp?: string
    message?: { role?: string }
  }>
  branch: Array<{ id: string }>
  leafId: string | null
  sessionFile?: string
  sessionId: string
  sessionName?: string
}
interface LiveSession {
  id: string
  cwd: string
  client: PiRpcClient
  bridge: DesktopBridge
  busy: boolean
  error: string | null
  stopping: boolean
  controller: AbortController
  lastSnapshotAt: number
  idleTimer: ReturnType<typeof setTimeout> | null
  queue: { steering: string[]; followUp: string[] }
  commandName: string
}

/** Pi's own standalone process is the agent runtime; this adapter only translates desktop operations. */
export class PiRpcRuntime implements HarnessAdapter {
  private readonly live = new Map<string, LiveSession>()
  private readonly starts = new Map<string, Promise<{ sessionId: string; cwd: string }>>()
  private readonly listeners = new Map<string, Set<(event: HarnessEvent) => void>>()
  private window: () => BrowserWindow | null = () => null
  private closing = false
  private maintenance = false
  private readonly commands = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >()
  private readonly batcher = new AgentEventBatcher((batch) => {
    const win = this.window()
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed())
      win.webContents.send(IPC_EVENT.agentEvent, batch)
  })
  constructor(
    private readonly sessions: SessionService,
    private readonly runtimes: RuntimeManager,
    private readonly options: {
      extensionPath: string
      configDir: () => string
      workspace?: ConstructorParameters<typeof AgentRuntimeService>[1]
    }
  ) {}
  attachWindow(getWindow: () => BrowserWindow | null): void {
    this.window = getWindow
  }
  diagnostics(): { implementation: 'pi'; sdkLoaded: boolean } {
    return { implementation: 'pi', sdkLoaded: false }
  }
  listRunning(): string[] {
    return [...this.live.values()].filter((s) => s.busy).map((s) => s.id)
  }
  isBusy(): boolean {
    return this.starts.size > 0 || this.listRunning().length > 0
  }
  async stopIdle(): Promise<void> {
    this.maintenance = true
    try {
      if (this.isBusy()) throw new AgentError('Pi sessions are busy')
      await Promise.all([...this.live.keys()].map((id) => this.stopSession(id)))
    } finally {
      this.maintenance = false
    }
  }
  subscribe(id: string, listener: (event: HarnessEvent) => void): () => void {
    const set = this.listeners.get(id) ?? new Set()
    set.add(listener)
    this.listeners.set(id, set)
    return () => {
      set.delete(listener)
      if (!set.size) this.listeners.delete(id)
    }
  }
  async startSession(input: StartAgentSessionInput): Promise<{ sessionId: string; cwd: string }> {
    if (this.closing || this.maintenance || this.runtimes.isChanging())
      throw new AgentError('Pi runtime is unavailable during shutdown or maintenance')
    if (input.sessionId) {
      const existing = this.live.get(input.sessionId)
      if (existing) return { sessionId: existing.id, cwd: existing.cwd }
      const pending = this.starts.get(input.sessionId)
      if (pending) return pending
    }
    const key = input.sessionId ?? randomUUID()
    const promise = this.construct(input, key)
    this.starts.set(key, promise)
    try {
      return await promise
    } finally {
      this.starts.delete(key)
    }
  }
  private async construct(
    input: StartAgentSessionInput,
    id: string
  ): Promise<{ sessionId: string; cwd: string }> {
    const pi = await this.runtimes.resolve('pi')
    if (!pi.valid || !pi.executablePath) throw new AgentError(pi.diagnosticMessages.join('; '))
    let cwd = input.cwd
    let file: string | null = null
    if (input.sessionId) {
      file = await this.sessions.resolvePath(input.sessionId)
      if (!file) throw new AgentError('Session not found')
      const detail = await this.sessions.get(input.sessionId)
      cwd = detail.info?.cwd ?? cwd
      if (!cwd) {
        const handle = await fs.open(file, 'r')
        try {
          const buffer = Buffer.alloc(16_384)
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
          cwd = JSON.parse(buffer.toString('utf8', 0, bytesRead).split('\n')[0]).cwd
        } finally {
          await handle.close()
        }
      }
    }
    if (!cwd) throw new AgentError('A workspace is required')
    await this.options.workspace?.prepareSession?.(id, cwd)
    const tools = (await this.options.workspace?.customTools?.(cwd, id)) ?? []
    const toolMap = new Map<string, ToolDefinition>(tools.map((tool) => [tool.name, tool]))
    let ready!: () => void
    const bridgeReady = new Promise<void>((resolve) => {
      ready = resolve
    })
    const client = new PiRpcClient()
    let live!: LiveSession
    const bridge = new DesktopBridge(async (method, params) => {
      if (method === 'ready') {
        if (live && typeof params.sessionId === 'string' && params.sessionId !== live.id) {
          const oldId = live.id
          live.id = params.sessionId
          this.live.delete(oldId)
          this.live.set(live.id, live)
          await this.options.workspace?.prepareSession?.(live.id, live.cwd)
        }
        ready()
        return null
      }
      if (method === 'tools')
        return tools.map(
          ({ name, description, label, parameters, promptSnippet, promptGuidelines }) => ({
            name,
            description,
            label,
            parameters,
            promptSnippet,
            promptGuidelines
          })
        )
      if (method === 'context')
        return {
          prompt: this.options.workspace?.getPrompt?.(live?.id ?? id),
          architectureHint: await this.options.workspace?.architectureHint?.(cwd!)
        }
      if (method === 'guard') {
        const name = String(params.name ?? '')
        if (name === 'write' || name === 'edit') {
          const target = extractToolPath(params.input)
          if (target) await this.options.workspace?.assertWritable?.(target, live?.id ?? id)
        }
        await this.options.workspace?.assertToolAllowed?.(
          name,
          params.input,
          live?.id ?? id,
          live?.controller.signal
        )
        return null
      }
      if (method === 'execute') {
        const currentTools =
          live && live.id !== id
            ? await this.options.workspace?.customTools?.(live.cwd, live.id)
            : undefined
        const tool =
          currentTools?.find((tool) => tool.name === String(params.name)) ??
          toolMap.get(String(params.name))
        if (!tool) throw new AgentError('Unknown desktop tool')
        live.controller.signal.throwIfAborted()
        return tool.execute(
          String(params.id),
          params.input as never,
          live.controller.signal,
          undefined,
          undefined as never
        )
      }
      if (method === 'command_result') {
        const pending = this.commands.get(String(params.id))
        if (pending) {
          this.commands.delete(String(params.id))
          if (params.error) pending.reject(new AgentError(String(params.error)))
          else pending.resolve(params.data)
        }
        return null
      }
      throw new AgentError('Unsupported desktop bridge request')
    })
    let env: NodeJS.ProcessEnv = {
      ...(await this.runtimes.environment('pi')),
      PI_CODING_AGENT_DIR: this.options.configDir()
    }
    let executable = pi.executablePath
    const args = ['--mode', 'rpc', '--extension', this.options.extensionPath]
    if (file) args.push('--session', file)
    else args.push('--session-id', id)
    if (input.provider) args.push('--provider', input.provider)
    if (input.modelId) args.push('--model', input.modelId)
    if (input.thinkingLevel && input.thinkingLevel !== 'auto')
      args.push('--thinking', input.thinkingLevel)
    if (input.toolNames?.length === 0) args.push('--no-tools')
    else if (input.toolNames) args.push('--tools', input.toolNames.join(','))
    if (/\.[cm]?js$/i.test(executable)) {
      const node = await this.runtimes.resolve('node')
      if (!node.valid || !node.executablePath)
        throw new AgentError('The npm Pi entry requires the selected Node runtime')
      args.unshift(executable)
      executable = node.executablePath
    }
    try {
      env = { ...env, ...(await bridge.start(os.tmpdir())) }
      live = {
        id,
        cwd,
        client,
        bridge,
        busy: false,
        error: null,
        stopping: false,
        controller: new AbortController(),
        lastSnapshotAt: 0,
        idleTimer: null,
        queue: { steering: [], followUp: [] },
        commandName: `desktop-${env.PI_HARNESS_DESKTOP_TOKEN!.slice(0, 12)}`
      }
      client.onEvent((event) => this.event(live, event))
      client.onExit(() => {
        if (this.live.get(live.id) === live) this.live.delete(live.id)
        if (!live.stopping)
          this.emit(live.id, {
            type: 'prompt_error',
            errorMessage: 'Pi process disconnected; resume this session to continue'
          })
        live.controller.abort()
        if (live.idleTimer) clearTimeout(live.idleTimer)
        void bridge.close()
        this.broadcastRunning()
      })
      client.start(executable, args, cwd, env)
      const state = (await client.request({ type: 'get_state' })) as {
        sessionId: string
        sessionFile?: string
      }
      let readyTimer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          bridgeReady,
          new Promise<never>((_, reject) => {
            readyTimer = setTimeout(
              () => reject(new AgentError('Desktop extension did not initialize')),
              15_000
            )
          })
        ])
      } finally {
        clearTimeout(readyTimer)
      }
      live.id = state.sessionId
      if (state.sessionFile) this.sessions.cachePath(state.sessionId, state.sessionFile)
      if (this.closing) throw new AgentError('Pi runtime is shutting down')
      this.live.set(live.id, live)
      this.armIdle(live)
      if (input.toolNames)
        await bridge.request('set_tools', {
          toolNames: input.toolNames,
          preserveExtensionTools: true
        })
      if (input.message?.trim()) await this.prompt(live.id, input.message)
      return { sessionId: live.id, cwd }
    } catch (error) {
      if (live) {
        live.stopping = true
        this.live.delete(live.id)
      }
      await client.stop()
      await bridge.close()
      throw error
    }
  }
  private async require(id: string): Promise<LiveSession> {
    if (!this.live.has(id)) await this.startSession({ sessionId: id })
    const live = this.live.get(id)
    if (!live) throw new AgentError('Pi session is unavailable')
    return live
  }
  async prompt(id: string, message: string, options: HarnessPromptOptions = {}): Promise<unknown> {
    if (this.closing || this.maintenance || this.runtimes.isChanging())
      throw new AgentError('Wait for runtime maintenance to finish')
    const error = validateAgentImages(options.images)
    if (error) throw new AgentError(error)
    const live = await this.require(id)
    const wasBusy = live.busy
    this.armIdle(live)
    live.busy = true
    if (!wasBusy) {
      live.error = null
      live.controller = new AbortController()
    }
    this.broadcastRunning()
    try {
      const result = await live.client.request({
        type: 'prompt',
        message,
        images: options.images,
        streamingBehavior: options.streamingBehavior
      })
      if ((result as { disposition?: string })?.disposition === 'handled') {
        const snapshot = (await live.bridge.request('snapshot')) as DesktopSnapshot
        live.busy = !snapshot.idle
        if (!live.busy) this.emit(live.id, { type: 'prompt_done', success: true })
        this.broadcastRunning()
      }
      return result
    } catch (error) {
      live.busy = wasBusy
      this.broadcastRunning()
      throw error
    }
  }
  async abort(id: string): Promise<void> {
    const live = this.live.get(id)
    if (!live) return
    live.controller.abort()
    await live.client.request({ type: 'abort' })
  }
  async stopSession(id: string): Promise<void> {
    const live = this.live.get(id)
    if (!live) return
    live.stopping = true
    if (live.idleTimer) clearTimeout(live.idleTimer)
    live.controller.abort()
    try {
      await live.client.request({ type: 'abort' }, 5000).catch(() => undefined)
      await live.client.stop()
    } finally {
      this.live.delete(id)
      await live.bridge.close()
      this.broadcastRunning()
    }
  }
  async shutdownAll(): Promise<void> {
    this.closing = true
    await Promise.allSettled([...this.starts.values()])
    await Promise.all([...this.live.keys()].map((id) => this.stopSession(id)))
    this.batcher.flush()
    this.batcher.dispose()
  }
  async steer(id: string, message: string, images?: unknown): Promise<void> {
    await this.executeAgentCommand(id, { type: 'steer', message, images })
  }
  async followUp(id: string, message: string, images?: unknown): Promise<void> {
    await this.executeAgentCommand(id, { type: 'follow_up', message, images })
  }
  async getAgentState(id: string): Promise<AgentStateSnapshot | null> {
    const live = this.live.get(id)
    if (!live) return null
    const [raw, desktop] = await Promise.all([
      live.client.request({ type: 'get_state' }),
      live.bridge.request('snapshot')
    ])
    const state = raw as {
      sessionId: string
      sessionFile?: string
      isStreaming: boolean
      isCompacting: boolean
      model?: { id: string; provider: string }
      thinkingLevel: string
      autoCompactionEnabled: boolean
      pendingMessageCount: number
    }
    const extra = desktop as DesktopSnapshot
    return {
      sessionId: state.sessionId,
      sessionFile: state.sessionFile ?? '',
      status: state.isCompacting ? 'compacting' : live.busy || !extra.idle ? 'running' : 'idle',
      isStreaming: state.isStreaming,
      isPromptRunning: live.busy,
      isBashRunning: false,
      isCompacting: state.isCompacting,
      model: state.model ? { id: state.model.id, provider: state.model.provider } : undefined,
      thinkingLevel: state.thinkingLevel,
      autoCompactionEnabled: state.autoCompactionEnabled,
      contextUsage: extra.contextUsage,
      pendingMessageCount: state.pendingMessageCount,
      queuedMessages: { steering: [...live.queue.steering], followUp: [...live.queue.followUp] }
    }
  }
  async getState(id: string) {
    const snapshot = await this.getAgentState(id)
    if (!snapshot) return null
    const live = await this.require(id)
    const [tools, thinking, stats] = await Promise.all([
      this.getTools(id),
      live.client.request({ type: 'get_available_thinking_levels' }),
      this.getStats(id)
    ])
    return mapHarnessState(
      snapshot,
      await this.getCapabilities(id),
      tools,
      (thinking as { levels: string[] }).levels,
      stats
    )
  }
  async getCapabilities(id: string): Promise<HarnessCapabilities> {
    await this.require(id)
    return {
      prompt: true,
      abort: true,
      steering: true,
      followUp: true,
      compaction: true,
      abortCompaction: true,
      autoCompaction: true,
      autoRetry: true,
      thinkingLevel: true,
      tools: true,
      skills: true,
      extensions: true,
      sessionFork: true,
      sessionTree: true,
      modelSwitch: true,
      contextUsage: true,
      stats: true
    }
  }
  async getTools(id: string): Promise<HarnessTool[]> {
    return ((await (await this.require(id)).bridge.request('snapshot')) as DesktopSnapshot).tools
  }
  async setTools(
    id: string,
    toolNames: string[],
    options: { preserveExtensionTools?: boolean } = {}
  ): Promise<void> {
    const live = await this.require(id)
    await live.bridge.request('set_tools', {
      toolNames,
      preserveExtensionTools: options.preserveExtensionTools ?? false
    })
  }
  async setModel(id: string, provider: string, modelId: string): Promise<void> {
    await this.executeAgentCommand(id, { type: 'set_model', provider, modelId })
  }
  async setThinkingLevel(id: string, level: string): Promise<void> {
    const client = (await this.require(id)).client
    const { levels } = (await client.request({ type: 'get_available_thinking_levels' })) as {
      levels: string[]
    }
    if (levels.includes(level)) await client.request({ type: 'set_thinking_level', level })
  }
  async compact(id: string, instructions?: string): Promise<unknown> {
    const live = await this.require(id)
    const wasBusy = live.busy
    live.busy = true
    this.broadcastRunning()
    try {
      return await (
        await this.require(id)
      ).client.request({ type: 'compact', customInstructions: instructions }, 300_000)
    } catch (error) {
      const message = (error as Error).message
      if (message.includes('session too small'))
        return { cancelled: true, reason: 'session-too-small' }
      if (message.includes('Already compacted'))
        return { cancelled: true, reason: 'already-compacted' }
      throw error
    } finally {
      live.busy = wasBusy
      this.broadcastRunning()
    }
  }
  async abortCompaction(id: string): Promise<void> {
    await (await this.require(id)).bridge.request('abort_compaction')
  }
  async setAutoCompaction(id: string, enabled: boolean): Promise<void> {
    await this.executeAgentCommand(id, { type: 'set_auto_compaction', enabled })
  }
  async fork(id: string, entryId: string): Promise<HarnessForkResult> {
    const live = await this.require(id)
    const result = (await live.client.request({ type: 'fork', entryId })) as { cancelled: boolean }
    if (result.cancelled) return result
    const state = (await live.client.request({ type: 'get_state' })) as {
      sessionId: string
      sessionFile?: string
    }
    this.live.delete(id)
    live.id = state.sessionId
    this.live.set(live.id, live)
    this.sessions.invalidate()
    if (state.sessionFile) this.sessions.cachePath(live.id, state.sessionFile)
    return { cancelled: false, newSessionId: live.id }
  }
  async navigateTree(id: string, targetId: string): Promise<unknown> {
    const live = await this.require(id)
    const requestId = randomUUID()
    let timer: ReturnType<typeof setTimeout> | undefined
    const result = new Promise((resolve, reject) => {
      this.commands.set(requestId, { resolve, reject })
      timer = setTimeout(() => {
        this.commands.delete(requestId)
        reject(new AgentError('Session navigation timed out'))
      }, 30_000)
    })
    // Observe rejection even when the RPC command itself fails first.
    void result.catch(() => undefined)
    try {
      await live.client.request({
        type: 'prompt',
        message: `/${live.commandName} ${JSON.stringify({ method: 'navigate_tree', targetId, id: requestId })}`
      })
      return await result
    } finally {
      clearTimeout(timer)
      this.commands.delete(requestId)
    }
  }
  async getStats(id: string): Promise<HarnessStats> {
    const live = await this.require(id)
    const [raw, tools] = await Promise.all([
      live.client.request({ type: 'get_session_stats' }),
      this.getTools(id)
    ])
    return {
      ...(raw as HarnessStats),
      activeTools: tools.filter((tool) => tool.active).length,
      pendingMessages: 0
    }
  }
  async getSession(id: string): Promise<HarnessSessionInfo> {
    const raw = (await (await this.require(id)).bridge.request('snapshot')) as DesktopSnapshot
    const active = new Set(raw.branch.map((entry) => entry.id))
    return {
      sessionId: raw.sessionId,
      name: raw.sessionName,
      persisted: Boolean(raw.sessionFile),
      leafId: raw.leafId,
      entries: raw.entries.map((entry) => ({
        id: entry.id,
        type: entry.type,
        parentId: entry.parentId,
        role: entry.message?.role,
        timestamp: entry.timestamp,
        active: active.has(entry.id)
      }))
    }
  }
  async executeAgentCommand(id: string, command: Record<string, unknown>): Promise<unknown> {
    const live = await this.require(id)
    switch (command.type) {
      case 'get_state':
        return this.getAgentState(id)
      case 'get_tools':
        return this.getTools(id)
      case 'set_tools':
        return this.setTools(id, command.toolNames as string[], {
          preserveExtensionTools: command.preserveExtensionTools !== false
        })
      case 'navigate_tree':
        return this.navigateTree(id, String(command.targetId))
      case 'abort_compaction':
        return this.abortCompaction(id)
      case 'fork':
        return this.fork(id, String(command.entryId))
      case 'set_thinking_level':
        return this.setThinkingLevel(id, String(command.level))
      case 'compact':
        return this.compact(id, command.customInstructions as string | undefined)
      case 'append_external_image_result': {
        if (live.busy)
          throw new AgentError('Finish the running task before saving generated images')
        // Pi's public read-only extension context cannot append a user message without
        // starting an agent turn. Use the existing native persistence helper while stopped.
        const file = (
          (await live.client.request({ type: 'get_state' })) as { sessionFile?: string }
        ).sessionFile
        await this.stopSession(id)
        const sdk = await loadPiCodingAgent()
        const manager =
          file && (await fs.stat(file).catch(() => null))
            ? sdk.SessionManager.open(file)
            : sdk.SessionManager.create(live.cwd, file ? path.dirname(file) : undefined, { id })
        const result = persistExternalImageResult(manager, command)
        this.sessions.invalidate()
        const saved = manager.getSessionFile()
        if (saved) this.sessions.cachePath(id, saved)
        await this.startSession({ sessionId: id, cwd: live.cwd })
        return result
      }
      case 'prompt':
        return this.prompt(id, String(command.message ?? ''), { images: command.images })
      case 'abort':
        return this.abort(id)
      case 'steer':
      case 'follow_up': {
        const error = validateAgentImages(command.images)
        if (error) throw new AgentError(error)
        return live.client.request({
          type: command.type,
          message: String(command.message ?? ''),
          images: command.images
        })
      }
      case 'set_model':
        return live.client.request({
          type: 'set_model',
          provider: String(command.provider ?? ''),
          modelId: String(command.modelId ?? '')
        })
      case 'set_auto_compaction':
        return live.client.request({
          type: 'set_auto_compaction',
          enabled: command.enabled === true
        })
      case 'get_session_stats':
        return this.getStats(id)
      case 'set_session_name': {
        const name = String(command.name ?? '').trim()
        if (!name || name.length > 256) throw new AgentError('Invalid session name')
        const result = await live.client.request({ type: 'set_session_name', name })
        this.sessions.invalidate()
        return result
      }
      default:
        throw new AgentError(`Unsupported command: ${String(command.type)}`)
    }
  }
  defaultToolNames(): string[] {
    return getToolNamesForPreset('default')
  }
  private event(live: LiveSession, event: Record<string, unknown>): void {
    if (hasAssistantSnapshot(event as AgentEvent)) {
      const now = Date.now()
      if (now - live.lastSnapshotAt < 200) event = { ...event, message: undefined }
      else live.lastSnapshotAt = now
    }
    if (event.type === 'extension_ui_request') {
      if (['select', 'confirm', 'input', 'editor'].includes(String(event.method)))
        live.client.write({ type: 'extension_ui_response', id: event.id, cancelled: true })
      return
    }
    if (event.type === 'queue_update') {
      live.queue = {
        steering: Array.isArray(event.steering)
          ? event.steering.filter((value): value is string => typeof value === 'string')
          : [],
        followUp: Array.isArray(event.followUp)
          ? event.followUp.filter((value): value is string => typeof value === 'string')
          : []
      }
    }
    if (event.type === 'agent_start') {
      live.busy = true
      live.error = null
    }
    if (event.type === 'message_end') {
      const message = event.message as { role?: string; errorMessage?: string; stopReason?: string }
      if (message?.role === 'assistant' && message.stopReason === 'error')
        live.error = inspectRuntimeError(message.errorMessage ?? 'Agent error').userMessage
    }
    if (event.type === 'agent_settled') {
      live.busy = false
      this.armIdle(live)
      if (live.error && !event.aborted)
        this.emit(live.id, { type: 'prompt_error', errorMessage: live.error })
      this.emit(live.id, event as AgentEvent)
      this.emit(live.id, {
        type: 'prompt_done',
        success: live.error === null,
        ...(live.error ? { errorMessage: live.error } : {})
      })
      this.sessions.invalidate()
    } else this.emit(live.id, event as AgentEvent)
    if (isRunningStateEvent(String(event.type))) this.broadcastRunning()
  }
  private emit(id: string, event: AgentEvent): void {
    const wire = toIpcAgentEvent(event)
    if (!wire) return
    this.batcher.push({ sessionId: id, event: wire })
    for (const mapped of mapAgentEvent(wire as AgentEvent))
      for (const listener of this.listeners.get(id) ?? []) listener(mapped)
  }
  private armIdle(live: LiveSession): void {
    if (live.idleTimer) clearTimeout(live.idleTimer)
    live.idleTimer = setTimeout(
      () => {
        if (live.busy) this.armIdle(live)
        else void this.stopSession(live.id)
      },
      10 * 60 * 1000
    )
    live.idleTimer.unref()
  }
  private broadcastRunning(): void {
    const win = this.window()
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed())
      win.webContents.send(IPC_EVENT.agentRunning, { ids: this.listRunning() })
  }
}

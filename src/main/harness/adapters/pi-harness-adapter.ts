import type { AgentStateSnapshot, StartAgentSessionInput } from '@shared/types/workspace'
import type {
  HarnessCapabilities,
  HarnessCompactionResult,
  HarnessEvent,
  HarnessForkResult,
  HarnessSessionInfo,
  HarnessState,
  HarnessStats,
  HarnessTool
} from '@shared/types/harness'
import type { AgentRuntimeService, AgentSessionWrapper } from '../../agent/agent-runtime-service'
import type { AgentSessionLike } from '../../agent/pi-sdk'
import { detectHarnessCapabilities, getThinkingOptions } from '../harness-capabilities'
import { HarnessError } from '../harness-error'
import { mapAgentEvent } from '../harness-events'
import { mapHarnessSession } from '../harness-session'
import { mapHarnessState } from '../harness-state'
import type {
  HarnessAdapter,
  HarnessPromptOptions,
  HarnessSessionStartResult
} from '../harness-types'

/** Adapts the existing Pi-backed AgentRuntimeService to stable desktop Harness DTOs. */
export class PiHarnessAdapter implements HarnessAdapter {
  constructor(private readonly agent: AgentRuntimeService) {}

  diagnostics(): { implementation: 'pi'; sdkLoaded: boolean } {
    return this.agent.diagnostics()
  }

  listRunning(): string[] {
    return this.agent.listRunning()
  }

  startSession(input: StartAgentSessionInput): Promise<HarnessSessionStartResult> {
    return this.agent.start(input)
  }

  stopSession(sessionId: string): Promise<void> {
    return this.agent.stop(sessionId)
  }

  prompt(sessionId: string, message: string, options: HarnessPromptOptions = {}): Promise<unknown> {
    return this.agent.prompt(sessionId, message, options)
  }

  abort(sessionId: string): Promise<void> {
    return this.agent.abort(sessionId)
  }

  async steer(sessionId: string, message: string, images?: unknown): Promise<void> {
    await this.requireCapability(sessionId, 'steering')
    await this.agent.command(sessionId, { type: 'steer', message, images })
  }

  async followUp(sessionId: string, message: string, images?: unknown): Promise<void> {
    await this.requireCapability(sessionId, 'followUp')
    await this.agent.command(sessionId, { type: 'follow_up', message, images })
  }

  getAgentState(sessionId: string): Promise<AgentStateSnapshot | null> {
    return this.agent.getState(sessionId)
  }

  async getState(sessionId: string): Promise<HarnessState | null> {
    const snapshot = await this.agent.getState(sessionId)
    if (!snapshot) return null
    const wrapper = this.requireLive(sessionId)
    let capabilities = detectHarnessCapabilities(wrapper.inner)
    let tools: HarnessTool[] = []
    if (capabilities.tools) {
      try {
        tools = mapTools(wrapper.inner)
      } catch {
        capabilities = { ...capabilities, tools: false }
      }
    }
    let stats: HarnessStats | undefined
    if (capabilities.stats) {
      try {
        stats = mapStats(wrapper.inner, snapshot, tools)
      } catch {
        capabilities = { ...capabilities, stats: false }
      }
    }
    return mapHarnessState(snapshot, capabilities, tools, getThinkingOptions(wrapper.inner), stats)
  }

  async getCapabilities(sessionId: string): Promise<HarnessCapabilities> {
    return detectHarnessCapabilities(this.requireLive(sessionId).inner)
  }

  async getTools(sessionId: string): Promise<HarnessTool[]> {
    await this.requireCapability(sessionId, 'tools')
    return this.agent.getTools(sessionId)
  }

  async setTools(
    sessionId: string,
    toolNames: string[],
    options: { preserveExtensionTools?: boolean } = {}
  ): Promise<void> {
    const wrapper = await this.requireCapability(sessionId, 'tools')
    const known = new Set(wrapper.inner.getAllTools().map((tool) => tool.name))
    const missing = toolNames.find((name) => !known.has(name))
    if (missing) {
      throw new HarnessError('TOOL_NOT_FOUND', `Tool not found: ${missing}`, { toolName: missing })
    }
    await this.agent.command(sessionId, {
      type: 'set_tools',
      toolNames,
      preserveExtensionTools: options.preserveExtensionTools ?? false
    })
  }

  async setModel(sessionId: string, provider: string, modelId: string): Promise<void> {
    await this.requireCapability(sessionId, 'modelSwitch')
    try {
      await this.agent.command(sessionId, { type: 'set_model', provider, modelId })
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Model not found:')) {
        throw new HarnessError('MODEL_NOT_FOUND', error.message, { provider, modelId })
      }
      throw error
    }
  }

  async setThinkingLevel(sessionId: string, level: string): Promise<void> {
    const wrapper = await this.requireCapability(sessionId, 'thinkingLevel')
    const options = getThinkingOptions(wrapper.inner)
    if (!options.includes(level)) {
      throw new HarnessError(
        'CAPABILITY_NOT_SUPPORTED',
        `Thinking level is unavailable: ${level}`,
        {
          level,
          options
        }
      )
    }
    await this.agent.command(sessionId, { type: 'set_thinking_level', level })
  }

  async compact(
    sessionId: string,
    instructions?: string
  ): Promise<HarnessCompactionResult | unknown> {
    await this.requireCapability(sessionId, 'compaction')
    return this.agent.command(sessionId, { type: 'compact', customInstructions: instructions })
  }

  async abortCompaction(sessionId: string): Promise<void> {
    const wrapper = await this.requireCapability(sessionId, 'compaction')
    if (typeof wrapper.inner.abortCompaction !== 'function') {
      throw new HarnessError('COMPACTION_NOT_AVAILABLE', 'This Pi version cannot abort compaction.')
    }
    await this.agent.command(sessionId, { type: 'abort_compaction' })
  }

  async setAutoCompaction(sessionId: string, enabled: boolean): Promise<void> {
    await this.requireCapability(sessionId, 'autoCompaction')
    await this.agent.command(sessionId, { type: 'set_auto_compaction', enabled })
  }

  async fork(sessionId: string, entryId: string): Promise<HarnessForkResult> {
    await this.requireCapability(sessionId, 'sessionFork')
    return (await this.agent.command(sessionId, {
      type: 'fork',
      entryId
    })) as HarnessForkResult
  }

  async navigateTree(sessionId: string, targetId: string): Promise<unknown> {
    await this.requireCapability(sessionId, 'sessionTree')
    return this.agent.command(sessionId, { type: 'navigate_tree', targetId })
  }

  async getStats(sessionId: string): Promise<HarnessStats> {
    const wrapper = await this.requireCapability(sessionId, 'stats')
    const snapshot = wrapper.snapshot()
    return mapStats(wrapper.inner, snapshot, mapTools(wrapper.inner))
  }

  async getSession(sessionId: string): Promise<HarnessSessionInfo> {
    return mapHarnessSession(this.requireLive(sessionId).inner)
  }

  subscribe(sessionId: string, listener: (event: HarnessEvent) => void): () => void {
    return this.agent.subscribe(sessionId, (event) => {
      for (const mapped of mapAgentEvent(event)) listener(mapped)
    })
  }

  executeAgentCommand(sessionId: string, command: Record<string, unknown>): Promise<unknown> {
    return this.agent.command(sessionId, command)
  }

  defaultToolNames(): string[] {
    return this.agent.defaultToolNames()
  }

  shutdownAll(): Promise<void> {
    return this.agent.shutdownAll()
  }

  private requireLive(sessionId: string): AgentSessionWrapper {
    const wrapper = this.agent.get(sessionId)
    if (!wrapper?.isAlive()) {
      throw new HarnessError(
        'SESSION_NOT_RUNNING',
        `Harness session is not running: ${sessionId}`,
        { sessionId },
        'Start or resume the session first.'
      )
    }
    return wrapper
  }

  private async requireCapability(
    sessionId: string,
    capability: keyof HarnessCapabilities
  ): Promise<AgentSessionWrapper> {
    let wrapper = this.agent.get(sessionId)
    if (!wrapper?.isAlive()) {
      try {
        await this.agent.start({ sessionId })
      } catch {
        throw new HarnessError('SESSION_NOT_FOUND', `Harness session not found: ${sessionId}`, {
          sessionId
        })
      }
      wrapper = this.agent.get(sessionId)
    }
    if (!wrapper?.isAlive()) {
      throw new HarnessError('SESSION_NOT_RUNNING', `Harness session is not running: ${sessionId}`)
    }
    if (!detectHarnessCapabilities(wrapper.inner)[capability]) {
      throw new HarnessError(
        'CAPABILITY_NOT_SUPPORTED',
        `Pi Harness capability is unavailable: ${capability}`,
        { capability }
      )
    }
    return wrapper
  }
}

function mapTools(session: AgentSessionLike): HarnessTool[] {
  const active = new Set(session.getActiveToolNames())
  return session.getAllTools().map((tool) => ({
    name: tool.name,
    description: tool.description,
    active: active.has(tool.name)
  }))
}

function mapStats(
  session: AgentSessionLike,
  snapshot: AgentStateSnapshot,
  tools: HarnessTool[]
): HarnessStats {
  const raw = session.getSessionStats?.() ?? {}
  const tokens = isRecord(raw.tokens) ? raw.tokens : null
  return {
    sessionId: typeof raw.sessionId === 'string' ? raw.sessionId : snapshot.sessionId,
    ...(session.sessionManager.getSessionName()
      ? { sessionName: session.sessionManager.getSessionName() }
      : {}),
    ...optionalNumber(raw, 'userMessages'),
    ...optionalNumber(raw, 'assistantMessages'),
    ...optionalNumber(raw, 'toolCalls'),
    ...optionalNumber(raw, 'toolResults'),
    ...optionalNumber(raw, 'totalMessages'),
    ...(tokens
      ? {
          tokens: {
            input: numberValue(tokens.input),
            output: numberValue(tokens.output),
            cacheRead: numberValue(tokens.cacheRead),
            cacheWrite: numberValue(tokens.cacheWrite),
            total: numberValue(tokens.total)
          }
        }
      : {}),
    ...(typeof raw.cost === 'number' && Number.isFinite(raw.cost) ? { cost: raw.cost } : {}),
    activeTools: tools.filter((tool) => tool.active).length,
    pendingMessages: snapshot.pendingMessageCount
  }
}

function optionalNumber<T extends string>(
  value: Record<string, unknown>,
  key: T
): Partial<Record<T, number>> {
  const candidate = value[key]
  return typeof candidate === 'number' && Number.isFinite(candidate)
    ? ({ [key]: candidate } as Partial<Record<T, number>>)
    : {}
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

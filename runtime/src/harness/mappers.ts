/**
 * Harness mapping helpers (runtime ports of `src/main/harness/harness-state.ts`,
 * `harness-capabilities.ts`, `harness-session.ts`, `harness-events.ts`).
 */

import type { AgentEvent, AgentStateSnapshot } from '../types.js'
import type {
  HarnessCapabilities,
  HarnessEvent,
  HarnessSessionEntry,
  HarnessSessionInfo,
  HarnessState,
  HarnessStats,
  HarnessTool
} from './types.js'
import type { AgentSessionLike } from '../pi/types.js'

export function mapHarnessState(
  snapshot: AgentStateSnapshot,
  capabilities: HarnessCapabilities,
  tools: HarnessTool[],
  thinkingOptions: string[],
  stats?: HarnessStats
): HarnessState {
  const context = snapshot.contextUsage
  const percent = context
    ? normalizePercent(
        context.percent,
        context.tokens !== null && context.contextWindow > 0
          ? (context.tokens / context.contextWindow) * 100
          : null
      )
    : null

  return {
    sessionId: snapshot.sessionId,
    runtime: {
      status:
        snapshot.status === 'compacting'
          ? 'compacting'
          : snapshot.status === 'running' || snapshot.status === 'starting'
            ? 'running'
            : 'idle',
      isStreaming: snapshot.isStreaming,
      isPromptRunning: snapshot.isPromptRunning,
      isBashRunning: snapshot.isBashRunning,
      isCompacting: snapshot.isCompacting
    },
    ...(snapshot.model ? { model: snapshot.model } : {}),
    thinking: {
      level: snapshot.thinkingLevel,
      options: thinkingOptions.includes(snapshot.thinkingLevel)
        ? thinkingOptions
        : [...thinkingOptions, snapshot.thinkingLevel]
    },
    context: context
      ? {
          tokens: context.tokens,
          contextWindow: context.contextWindow,
          percent
        }
      : null,
    compaction: {
      auto: snapshot.autoCompactionEnabled,
      running: snapshot.isCompacting
    },
    queue: {
      pendingMessages: snapshot.pendingMessageCount,
      steering: [...snapshot.queuedMessages.steering],
      followUp: [...snapshot.queuedMessages.followUp]
    },
    tools,
    capabilities,
    ...(stats ? { stats } : {})
  }
}

function normalizePercent(value: number | null, fallback: number | null): number | null {
  const candidate = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  if (candidate === null || !Number.isFinite(candidate)) return null
  return Math.min(100, Math.max(0, candidate))
}

export function detectHarnessCapabilities(session: AgentSessionLike): HarnessCapabilities {
  const manager = session.sessionManager
  const persisted = callBoolean(() => manager.isPersisted())
  return {
    prompt: typeof session.prompt === 'function',
    abort: typeof session.abort === 'function',
    steering: typeof session.steer === 'function',
    followUp: typeof session.followUp === 'function',
    compaction: typeof session.compact === 'function',
    autoCompaction: typeof session.setAutoCompactionEnabled === 'function',
    thinkingLevel: typeof session.setThinkingLevel === 'function',
    tools:
      typeof session.getAllTools === 'function' &&
      typeof session.getActiveToolNames === 'function' &&
      typeof session.setActiveToolsByName === 'function',
    sessionFork:
      persisted &&
      typeof manager.getEntry === 'function' &&
      typeof manager.createBranchedSession === 'function',
    sessionTree:
      typeof session.navigateTree === 'function' && typeof manager.getEntries === 'function',
    modelSwitch:
      typeof session.setModel === 'function' &&
      typeof session.modelRuntime?.getModel === 'function',
    contextUsage: typeof session.getContextUsage === 'function',
    stats: typeof session.getSessionStats === 'function'
  }
}

export function getThinkingOptions(session: AgentSessionLike): string[] {
  if (typeof session.getAvailableThinkingLevels === 'function') {
    try {
      const levels = session.getAvailableThinkingLevels()
      if (Array.isArray(levels) && levels.length) return [...new Set(levels.map(String))]
    } catch {
      /* Older Pi versions may expose the method without supporting this model. */
    }
  }
  return session.supportsThinking?.() === false ? ['off'] : ['off']
}

export function mapHarnessSession(session: AgentSessionLike): HarnessSessionInfo {
  const manager = session.sessionManager
  const branch = readArray(() => manager.getBranch())
  const activeIds = new Set(branch.map(entryId).filter((id): id is string => id !== null))
  const entries = readArray(() => manager.getEntries())
    .map((entry) => mapEntry(entry, activeIds))
    .filter((entry): entry is HarnessSessionEntry => entry !== null)
  const name = readValue(() => manager.getSessionName(), undefined)

  return {
    sessionId: session.sessionId,
    ...(name ? { name } : {}),
    persisted: readValue(() => manager.isPersisted(), false),
    leafId: readValue(() => manager.getLeafId(), null),
    entries
  }
}

/** Redact secret-shaped text before relaying runtime errors to any UI. */
export function redactSecretText(value: string): string {
  const MASK = '[REDACTED]'
  return value
    .replace(/(\bBearer\s+)[A-Za-z0-9._~+/=-]+/gi, `$1${MASK}`)
    .replace(/([?&](?:key|api[-_]?key|access[-_]?token|token)=)[^&#\s]+/gi, `$1${MASK}`)
    .replace(/(\s-w\s+)(?:"[^"]*"|'[^']*'|\S+)/g, `$1${MASK}`)
    .replace(/\b((?:sk|rk|pk)-)[A-Za-z0-9_-]{8,}\b/g, `$1${MASK}`)
    .replace(
      /((?:api[-_]?key|authorization|token|secret|password|cookie)\s*[:=]\s*["']?)[^"',;\s}]+/gi,
      `$1${MASK}`
    )
}

export function mapAgentEvent(event: AgentEvent, timestamp = Date.now()): HarnessEvent[] {
  switch (event.type) {
    case 'agent_start':
      return [{ type: 'runtime.started', timestamp }]
    case 'agent_end':
    case 'agent_settled':
      return [{ type: 'runtime.idle', timestamp }]
    case 'prompt_done':
      return event.success === false
        ? [
            {
              type: 'runtime.error',
              timestamp,
              message: redactSecretText(String(event.errorMessage ?? 'Agent error'))
            }
          ]
        : [{ type: 'prompt.completed', timestamp }]
    case 'prompt_error':
      return [
        {
          type: 'runtime.error',
          timestamp,
          message: redactSecretText(String(event.errorMessage ?? 'Agent error'))
        }
      ]
    case 'message_start':
      return [{ type: 'message.started', timestamp }]
    case 'message_end':
      return mapMessageEnd(event, timestamp)
    case 'tool_execution_start':
      return [
        {
          type: 'tool.started',
          timestamp,
          toolCallId: event.toolCallId == null ? undefined : String(event.toolCallId),
          toolName: String(event.toolName ?? 'unknown')
        }
      ]
    case 'tool_execution_end':
      return [
        {
          type: 'tool.completed',
          timestamp,
          toolCallId: event.toolCallId == null ? undefined : String(event.toolCallId),
          toolName: String(event.toolName ?? 'unknown'),
          isError: event.isError === true
        }
      ]
    case 'compaction_start':
    case 'auto_compaction_start':
      return [
        {
          type: 'compaction.started',
          timestamp,
          automatic: event.type === 'auto_compaction_start' || event.reason !== 'manual'
        }
      ]
    case 'compaction_end':
    case 'auto_compaction_end':
      return [
        {
          type: 'compaction.completed',
          timestamp,
          automatic: event.type === 'auto_compaction_end' || event.reason !== 'manual',
          aborted: event.aborted === true
        }
      ]
    case 'queue_update':
      return [
        {
          type: 'queue.changed',
          timestamp,
          steering: Array.isArray(event.steering) ? event.steering.length : 0,
          followUp: Array.isArray(event.followUp) ? event.followUp.length : 0
        }
      ]
    case 'thinking_level_changed':
      return [{ type: 'thinking.changed', timestamp, level: String(event.level ?? 'off') }]
    default:
      return []
  }
}

function mapMessageEnd(event: AgentEvent, timestamp: number): HarnessEvent[] {
  const message = event.message as
    | {
        role?: string
        model?: string
        provider?: string
        usage?: {
          input?: unknown
          output?: unknown
          cacheRead?: unknown
          cacheWrite?: unknown
          cost?: { total?: unknown }
        }
      }
    | undefined
  if (!message || message.role !== 'assistant') return []
  const usage = message.usage
  if (!usage) return [{ type: 'message.completed', timestamp }]
  const number = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : 0
  const cost =
    typeof usage.cost?.total === 'number' && Number.isFinite(usage.cost.total)
      ? usage.cost.total
      : null
  return [
    {
      type: 'message.completed',
      timestamp,
      usage: {
        input: number(usage.input),
        output: number(usage.output),
        cacheRead: number(usage.cacheRead),
        cacheWrite: number(usage.cacheWrite),
        total: number(usage.input) + number(usage.output) + number(usage.cacheRead),
        cost
      },
      ...(typeof message.model === 'string' && message.model ? { model: message.model } : {}),
      ...(typeof message.provider === 'string' && message.provider
        ? { provider: message.provider }
        : {})
    }
  ]
}

function mapEntry(value: unknown, activeIds: Set<string>): HarnessSessionEntry | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.type !== 'string')
    return null
  return {
    id: value.id,
    parentId: typeof value.parentId === 'string' ? value.parentId : null,
    type: value.type,
    ...(isRecord(value.message) && typeof value.message.role === 'string'
      ? { role: value.message.role }
      : {}),
    ...(typeof value.timestamp === 'string' ? { timestamp: value.timestamp } : {}),
    ...(typeof value.label === 'string' ? { label: value.label } : {}),
    active: activeIds.has(value.id)
  }
}

function entryId(value: unknown): string | null {
  return isRecord(value) && typeof value.id === 'string' ? value.id : null
}

function readArray(read: () => unknown[]): unknown[] {
  return readValue(read, [])
}

function readValue<T>(read: () => T, fallback: T): T {
  try {
    return read()
  } catch {
    return fallback
  }
}

function callBoolean(fn: () => boolean): boolean {
  try {
    return fn()
  } catch {
    return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function mapTools(session: AgentSessionLike): HarnessTool[] {
  const active = new Set(session.getActiveToolNames())
  return session.getAllTools().map((tool) => ({
    name: tool.name,
    description: tool.description,
    active: active.has(tool.name)
  }))
}

export function mapStats(
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

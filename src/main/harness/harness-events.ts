import type { AgentEvent } from '@shared/types/workspace'
import type { HarnessEvent } from '@shared/types/harness'
import { redactSecretText } from '../services/logger'

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

/**
 * Assistant turn completions carry the authoritative per-message usage:
 * tokens, estimated cost and model identity. This is the single source the
 * Run Registry accumulates — never a second bookkeeping pipeline.
 */
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

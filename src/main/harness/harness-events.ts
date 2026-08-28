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
      return [{ type: 'prompt.completed', timestamp }]
    case 'prompt_error':
      return [
        {
          type: 'runtime.error',
          timestamp,
          message: redactSecretText(String(event.errorMessage ?? 'Agent error'))
        }
      ]
    case 'tool_execution_start':
      return [{ type: 'tool.started', timestamp, toolName: String(event.toolName ?? 'unknown') }]
    case 'tool_execution_end':
      return [
        {
          type: 'tool.completed',
          timestamp,
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

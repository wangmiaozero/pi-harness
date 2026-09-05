import type { AgentEvent } from '../types/workspace'
import type { ClientAssistantMessageEvent } from '../workspace/agent-event-wire'
import type { PetEvent } from './types'

/** Convert Pi's existing event stream into the small Pet observer protocol. */
export function adaptAgentEventToPetEvents(event: AgentEvent): PetEvent[] {
  switch (event.type) {
    case 'agent_start':
      return [{ type: 'TASK_STARTED' }]
    case 'message_update':
      return adaptAssistantEvent(
        event.assistantMessageEvent as ClientAssistantMessageEvent | undefined
      )
    case 'message_end':
      return [{ type: 'STREAM_FINISHED' }, { type: 'THINKING_FINISHED' }]
    case 'tool_execution_start':
      return [
        {
          type: 'TOOL_CALL_STARTED',
          id: String(event.toolCallId ?? ''),
          tool: String(event.toolName ?? 'tool')
        }
      ]
    case 'tool_execution_end':
      return [
        {
          type: 'TOOL_CALL_FINISHED',
          id: String(event.toolCallId ?? ''),
          failed: event.isError === true
        }
      ]
    case 'prompt_error':
      return [{ type: 'TASK_FAILED' }]
    case 'prompt_done':
      return event.success === false
        ? [{ type: 'TASK_FAILED' }]
        : [{ type: 'TASK_SUCCEEDED', celebrate: true }]
    case 'agent_end':
    case 'agent_settled':
      return [{ type: 'RUNTIME_SETTLED' }]
    case 'auto_retry_start':
    case 'summarization_retry_scheduled':
      return [
        {
          type: 'WARNING',
          durationMs: Math.max(3000, Number(event.delayMs ?? 0) + 1500)
        }
      ]
    case 'auto_retry_end':
    case 'summarization_retry_finished':
      return event.success === false ? [{ type: 'TASK_FAILED' }] : [{ type: 'WARNING_CLEARED' }]
    case 'compaction_start':
    case 'auto_compaction_start':
      return [{ type: 'THINKING_STARTED' }]
    case 'compaction_end':
    case 'auto_compaction_end':
      return [{ type: 'THINKING_FINISHED' }]
    default:
      return []
  }
}

function adaptAssistantEvent(event?: ClientAssistantMessageEvent): PetEvent[] {
  if (!event) return []
  switch (event.type) {
    case 'thinking_start':
    case 'thinking_delta':
      return [{ type: 'THINKING_STARTED' }]
    case 'thinking_end':
      return [{ type: 'THINKING_FINISHED' }]
    case 'text_start':
    case 'text_delta':
      return [{ type: 'STREAM_STARTED' }]
    case 'toolcall_start':
      return event.toolName
        ? [
            {
              type: 'TOOL_CALL_STARTED',
              id: event.id ?? `pending:${event.contentIndex ?? 0}`,
              tool: event.toolName
            }
          ]
        : []
    default:
      return []
  }
}

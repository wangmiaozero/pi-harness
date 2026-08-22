import type { AgentEvent, AssistantMessage } from '../types/workspace'

export interface AgentEventLike {
  type: string
  [key: string]: unknown
}

export type ClientAssistantMessageEvent = {
  type: string
  contentIndex?: number
  delta?: string
  content?: string
  id?: string
  toolName?: string
  toolCall?: { id: string; name: string; arguments: Record<string, unknown> }
  [key: string]: unknown
}

export type ClientMessageUpdateEvent = {
  type: 'message_update'
  assistantMessageEvent: ClientAssistantMessageEvent
}

const OMITTED_EVENT_TYPES = new Set(['turn_start', 'turn_end'])

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toolCallMetadata(event: Record<string, unknown>): { id: string; toolName: string } | null {
  if (
    (event.type !== 'toolcall_start' && event.type !== 'toolcall_delta') ||
    !isObject(event.partial)
  ) {
    return null
  }
  const content = event.partial.content
  const contentIndex = event.contentIndex
  if (!Array.isArray(content) || typeof contentIndex !== 'number') return null

  const block = content[contentIndex]
  if (!isObject(block) || block.type !== 'toolCall') return null
  const id =
    typeof block.id === 'string'
      ? block.id
      : typeof block.toolCallId === 'string'
        ? block.toolCallId
        : null
  const toolName =
    typeof block.name === 'string'
      ? block.name
      : typeof block.toolName === 'string'
        ? block.toolName
        : null
  return id !== null && toolName !== null ? { id, toolName } : null
}

/**
 * Strip bulky `partial` payloads from message_update and drop turn noise.
 * Renderer applies the remaining deltas incrementally.
 */
export function toClientAgentEvent(
  event: AgentEventLike
): AgentEventLike | ClientMessageUpdateEvent | null {
  if (OMITTED_EVENT_TYPES.has(event.type)) return null

  if (event.type === 'message_update') {
    const assistantMessageEvent = event.assistantMessageEvent
    if (
      typeof assistantMessageEvent !== 'object' ||
      assistantMessageEvent === null ||
      Array.isArray(assistantMessageEvent)
    ) {
      return null
    }

    const record = assistantMessageEvent as Record<string, unknown>
    if (!('partial' in record)) {
      return {
        type: 'message_update',
        assistantMessageEvent: record as ClientAssistantMessageEvent
      }
    }

    const metadata = toolCallMetadata(record)
    const { partial: _partial, ...deltaEvent } = record
    void _partial
    return {
      type: 'message_update',
      assistantMessageEvent: metadata
        ? { ...deltaEvent, ...metadata }
        : (deltaEvent as ClientAssistantMessageEvent)
    }
  }

  if (event.type === 'tool_execution_update') {
    return {
      type: 'tool_execution_update',
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      partialResult: event.partialResult
    }
  }

  if (event.type === 'agent_end') return { type: 'agent_end' }
  return event
}

export function isCompactionEvent(type: string): boolean {
  return (
    type === 'compaction_start' ||
    type === 'compaction_end' ||
    type === 'auto_compaction_start' ||
    type === 'auto_compaction_end'
  )
}

export function isRunningStateEvent(type: string): boolean {
  return (
    type === 'agent_start' ||
    type === 'agent_end' ||
    type === 'agent_settled' ||
    isCompactionEvent(type)
  )
}

export function isIdleResetEvent(type: string): boolean {
  return (
    type === 'agent_end' ||
    type === 'agent_settled' ||
    type === 'auto_compaction_end' ||
    type === 'compaction_end'
  )
}

export type { AgentEvent, AssistantMessage }

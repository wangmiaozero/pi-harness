import { normalizeStreamingToolCalls } from './normalize'
import type { AgentMessage, AssistantContentBlock, AssistantMessage } from '../types/workspace'
import type { ClientAssistantMessageEvent } from './agent-event-wire'

export interface StreamingState {
  isStreaming: boolean
  streamingMessage: AssistantMessage | null
}

export type StreamAction =
  | { type: 'start' }
  | { type: 'snapshot'; message: AgentMessage }
  | { type: 'delta'; event: ClientAssistantMessageEvent }
  | { type: 'end' }

export const INITIAL_STREAMING_STATE: StreamingState = {
  isStreaming: false,
  streamingMessage: null
}

function updateContentBlock(
  state: StreamingState,
  contentIndex: number,
  update: (current: AssistantContentBlock | undefined) => AssistantContentBlock | null
): StreamingState {
  const message = state.streamingMessage
  if (!message || !Number.isInteger(contentIndex) || contentIndex < 0) return state

  const content = [...message.content]
  const nextBlock = update(content[contentIndex])
  if (!nextBlock) return state
  content[contentIndex] = nextBlock
  return {
    isStreaming: true,
    streamingMessage: { ...message, content }
  }
}

function applyDelta(state: StreamingState, event: ClientAssistantMessageEvent): StreamingState {
  const contentIndex = typeof event.contentIndex === 'number' ? event.contentIndex : -1
  switch (event.type) {
    case 'text_start':
      return updateContentBlock(state, contentIndex, (current) =>
        current?.type === 'text' ? current : { type: 'text', text: '' }
      )
    case 'text_delta':
      return updateContentBlock(state, contentIndex, (current) =>
        current?.type === 'text'
          ? { ...current, text: current.text + String(event.delta ?? '') }
          : null
      )
    case 'text_end':
      return updateContentBlock(state, contentIndex, (current) => ({
        ...(current?.type === 'text' ? current : { type: 'text', text: '' }),
        type: 'text',
        text: String(event.content ?? '')
      }))
    case 'thinking_start':
      return updateContentBlock(state, contentIndex, (current) =>
        current?.type === 'thinking' ? current : { type: 'thinking', thinking: '' }
      )
    case 'thinking_delta':
      return updateContentBlock(state, contentIndex, (current) =>
        current?.type === 'thinking'
          ? { ...current, thinking: current.thinking + String(event.delta ?? '') }
          : null
      )
    case 'thinking_end':
      return updateContentBlock(state, contentIndex, (current) => ({
        ...(current?.type === 'thinking' ? current : { type: 'thinking', thinking: '' }),
        type: 'thinking',
        thinking: String(event.content ?? '')
      }))
    case 'toolcall_start':
      return updateContentBlock(state, contentIndex, (current) => {
        if (current?.type === 'toolCall') {
          return {
            ...current,
            toolCallId: event.id ?? current.toolCallId,
            toolName: event.toolName ?? current.toolName,
            rawInput: current.rawInput ?? ''
          }
        }
        if (typeof event.toolName !== 'string') return null
        return {
          type: 'toolCall',
          toolCallId: event.id ?? '',
          toolName: event.toolName,
          input: {},
          rawInput: ''
        }
      })
    case 'toolcall_delta':
      return updateContentBlock(state, contentIndex, (current) =>
        current?.type === 'toolCall'
          ? {
              ...current,
              toolCallId: event.id || current.toolCallId,
              toolName: event.toolName || current.toolName,
              rawInput: (current.rawInput ?? '') + String(event.delta ?? '')
            }
          : null
      )
    case 'toolcall_end': {
      const toolCall = event.toolCall
      if (!toolCall) return state
      return updateContentBlock(state, contentIndex, () => ({
        type: 'toolCall',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        input: toolCall.arguments
      }))
    }
    default:
      return state
  }
}

export function streamReducer(state: StreamingState, action: StreamAction): StreamingState {
  switch (action.type) {
    case 'start':
      return { isStreaming: true, streamingMessage: null }
    case 'snapshot': {
      const message = normalizeStreamingToolCalls(action.message)
      return message.role === 'assistant' ? { isStreaming: true, streamingMessage: message } : state
    }
    case 'delta':
      return applyDelta(state, action.event)
    case 'end':
      return INITIAL_STREAMING_STATE
    default:
      return state
  }
}

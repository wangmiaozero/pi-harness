import type {
  AgentMessage,
  AssistantContentBlock,
  ToolCallContent,
  ToolResultMessage
} from '@shared/types/workspace'
import type { MessageFileChanges } from './message-file-changes'

export interface HistoryItem {
  key: string
  message: AgentMessage
  entryId?: string
  fileChanges?: MessageFileChanges
}

export interface ToolResultEntry {
  message: ToolResultMessage
  entryId?: string
}

export type ToolResults = ReadonlyMap<string, ToolResultEntry>
export type ActivityKind = 'read' | 'search' | 'write' | 'edit' | 'command' | 'tool' | 'thinking'
export type PresentationItem =
  | { type: 'message'; key: string; item: HistoryItem }
  | { type: 'activity'; key: string; items: HistoryItem[] }

export function toolActivityKind(name: string): ActivityKind {
  switch (name.toLowerCase()) {
    case 'read':
      return 'read'
    case 'grep':
    case 'find':
    case 'ls':
      return 'search'
    case 'write':
      return 'write'
    case 'edit':
      return 'edit'
    case 'bash':
      return 'command'
    default:
      return 'tool'
  }
}

export function toolActivityTarget(block: ToolCallContent): string {
  const input = block.input
  for (const key of ['command', 'path', 'file_path', 'filePath', 'pattern', 'query', 'url']) {
    if (typeof input[key] === 'string' && input[key].trim()) {
      return input[key].replace(/\s+/g, ' ').trim()
    }
  }
  return ''
}

export function isActivityOnly(item: HistoryItem): boolean {
  const message = item.message
  if (message.role !== 'assistant') {
    return message.role === 'toolResult' || message.role === 'bashExecution'
  }
  return (
    !item.fileChanges &&
    !message.errorMessage &&
    message.content.some((block) => block.type === 'thinking' || block.type === 'toolCall') &&
    message.content.every(
      (block) =>
        block.type === 'thinking' ||
        block.type === 'toolCall' ||
        (block.type === 'text' && !block.text.trim())
    )
  )
}

function splitAssistantItem(item: HistoryItem): HistoryItem[] {
  const message = item.message
  if (message.role !== 'assistant' || isActivityOnly(item)) return [item]
  if (!message.content.some((block) => block.type === 'toolCall' || block.type === 'thinking'))
    return [item]

  const segments: Array<{ activity: boolean; start: number; content: AssistantContentBlock[] }> = []
  message.content.forEach((block, index) => {
    if (block.type === 'text' && !block.text.trim()) return
    const activity = block.type === 'toolCall' || block.type === 'thinking'
    const previous = segments.at(-1)
    if (previous?.activity === activity) previous.content.push(block)
    else segments.push({ activity, start: index, content: [block] })
  })
  // Errors and file-change evidence remain visible even after a tool-only response.
  if ((message.errorMessage || item.fileChanges) && segments.at(-1)?.activity !== false) {
    segments.push({ activity: false, start: message.content.length, content: [] })
  }
  let narrativeSeen = false
  return segments.map((segment, index) => {
    const last = index === segments.length - 1
    const key = segment.activity
      ? `${item.key}:activity-${segment.start}`
      : narrativeSeen
        ? `${item.key}:text-${segment.start}`
        : item.key
    if (!segment.activity) narrativeSeen = true
    return {
      key,
      entryId: last ? item.entryId : undefined,
      fileChanges: last ? item.fileChanges : undefined,
      message: {
        ...message,
        content: segment.content,
        errorMessage: last ? message.errorMessage : undefined
      }
    }
  })
}

/** Presentation only: keep Native messages intact and pair calls within their user turn. */
export function buildMessagePresentation(items: readonly HistoryItem[]) {
  const segments = items.flatMap(splitAssistantItem)
  const results = new Map<string, Map<string, ToolResultEntry>>()
  const pending = new Map<string, string>()
  const pairedResults = new Set<string>()
  for (const item of segments) {
    const message = item.message
    if (message.role === 'user') pending.clear()
    if (message.role === 'assistant') {
      for (const block of message.content) {
        if (block.type === 'toolCall' && block.toolCallId) {
          pending.set(block.toolCallId, item.key)
        }
      }
    } else if (message.role === 'toolResult') {
      const owner = pending.get(message.toolCallId)
      if (!owner) continue
      const ownerResults = results.get(owner) ?? new Map<string, ToolResultEntry>()
      ownerResults.set(message.toolCallId, { message, entryId: item.entryId })
      results.set(owner, ownerResults)
      pairedResults.add(item.key)
      pending.delete(message.toolCallId)
    }
  }

  const presentation: PresentationItem[] = []
  for (const item of segments) {
    if (pairedResults.has(item.key)) continue
    if (!isActivityOnly(item)) {
      presentation.push({ type: 'message', key: item.key, item })
      continue
    }
    const previous = presentation.at(-1)
    if (previous?.type === 'activity') previous.items.push(item)
    else presentation.push({ type: 'activity', key: item.key, items: [item] })
  }
  return { items: presentation, results, pending }
}

export type ConversationItem =
  | { type: 'message'; key: string; item: HistoryItem }
  | { type: 'turn'; key: string; items: PresentationItem[]; text: string }

/** One visible assistant response per user turn, retaining the order of all parts. */
export function groupConversationTurns(items: readonly PresentationItem[]): ConversationItem[] {
  const conversation: ConversationItem[] = []
  let turn: Extract<ConversationItem, { type: 'turn' }> | null = null
  let userKey = 'initial'
  for (const item of items) {
    if (item.type === 'message' && item.item.message.role === 'user') {
      conversation.push(item)
      turn = null
      userKey = item.key
      continue
    }
    if (
      !turn &&
      item.type === 'message' &&
      item.item.message.role === 'custom' &&
      item.item.message.customType === 'compaction'
    ) {
      conversation.push(item)
      continue
    }
    if (!turn) {
      turn = { type: 'turn', key: `turn:${userKey}`, items: [], text: '' }
      conversation.push(turn)
    }
    turn.items.push(item)
    if (item.type === 'message' && item.item.message.role === 'assistant') {
      const text = item.item.message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n\n')
        .trim()
      if (text) turn.text += `${turn.text ? '\n\n' : ''}${text}`
    }
  }
  return conversation
}

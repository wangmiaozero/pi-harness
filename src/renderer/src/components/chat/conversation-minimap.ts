import type { AgentMessage } from '@shared/types/workspace'

export interface MinimapMessage {
  key: string
  message: AgentMessage
}

export interface ConversationMinimapMarker {
  id: string
  role: 'user' | 'assistant'
  preview: string
}

export const CONVERSATION_MINIMAP_PREVIEW_MAX_CHARS = 280

/** One-page transcripts gain nothing from a rail; only overflow earns one. */
export function shouldRenderConversationMinimap(input: {
  markerCount: number
  overflows: boolean
}): boolean {
  return input.markerCount >= 2 && input.overflows
}

/** Plain text of a message: user strings or text blocks; tool noise stays out. */
export function messageTextContent(message: AgentMessage): string {
  const content: unknown = (message as { content?: unknown }).content
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (
      block &&
      typeof block === 'object' &&
      (block as { type?: unknown }).type === 'text' &&
      typeof (block as { text?: unknown }).text === 'string'
    ) {
      const text = (block as { text: string }).text.trim()
      if (text) parts.push(text)
    }
  }
  return parts.join('\n\n').trim()
}

function appendPreview(current: string, next: string): string {
  if (!next || current.length >= CONVERSATION_MINIMAP_PREVIEW_MAX_CHARS) {
    return current
  }
  return `${current}${current ? '\n\n' : ''}${next}`.slice(
    0,
    CONVERSATION_MINIMAP_PREVIEW_MAX_CHARS
  )
}

/** Build one user marker and one assistant marker per conversational turn. */
export function buildConversationMinimapMarkers(
  messages: MinimapMessage[]
): ConversationMinimapMarker[] {
  const markers: ConversationMinimapMarker[] = []
  let assistantMarkerIndex: number | null = null

  for (const entry of messages) {
    if (entry.message.role === 'user') {
      markers.push({
        id: entry.key,
        role: 'user',
        preview: messageTextContent(entry.message).slice(
          0,
          CONVERSATION_MINIMAP_PREVIEW_MAX_CHARS
        )
      })
      assistantMarkerIndex = null
      continue
    }
    if (entry.message.role !== 'assistant') continue

    // Later fragments cannot change a saturated preview or its first anchor.
    if (
      assistantMarkerIndex !== null &&
      markers[assistantMarkerIndex].preview.length >= CONVERSATION_MINIMAP_PREVIEW_MAX_CHARS
    ) {
      continue
    }
    const content = messageTextContent(entry.message)
    if (!content) continue
    if (assistantMarkerIndex === null) {
      markers.push({
        id: entry.key,
        role: 'assistant',
        preview: content.slice(0, CONVERSATION_MINIMAP_PREVIEW_MAX_CHARS)
      })
      assistantMarkerIndex = markers.length - 1
      continue
    }

    const marker = markers[assistantMarkerIndex]
    marker.preview = appendPreview(marker.preview, content)
  }

  return markers
}

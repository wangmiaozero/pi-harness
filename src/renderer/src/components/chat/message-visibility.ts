import type { AgentMessage } from '@shared/types/workspace'

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function hasImageData(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

export function hasRenderableMessageContent(message: AgentMessage): boolean {
  switch (message.role) {
    case 'user':
    case 'toolResult':
      if (typeof message.content === 'string') return hasText(message.content)
      return message.content.some((block) =>
        block.type === 'text' ? hasText(block.text) : hasImageData(block.data)
      )
    case 'assistant':
      if (hasText(message.errorMessage)) return true
      return message.content.some((block) => {
        if (block.type === 'text') return hasText(block.text)
        if (block.type === 'thinking') return hasText(block.thinking) || block.deferred === true
        if (block.type === 'toolCall') return hasText(block.toolName) || hasText(block.toolCallId)
        return hasImageData(block.data)
      })
    case 'bashExecution':
      return hasText(message.command) || hasText(message.output)
    case 'custom':
      if (!message.display) return false
      if (typeof message.content === 'string') return hasText(message.content)
      return message.content.some((block) =>
        block.type === 'text' ? hasText(block.text) : hasImageData(block.data)
      )
  }
}

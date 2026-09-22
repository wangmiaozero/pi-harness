/**
 * Session export rendering. Dialog + file write stay in the Rust host.
 */

import type { AgentMessage, SessionDetail } from '../vendor/shared/types/workspace.js'

export function renderSessionExport(
  detail: SessionDetail,
  format: 'html' | 'markdown'
): { body: string; defaultName: string } {
  const defaultName = sanitizeFileName(detail.info?.name || detail.sessionId)
  const markdown = renderMarkdown(detail)
  return {
    defaultName,
    body: format === 'html' ? renderHtmlDocument(defaultName, markdown) : markdown
  }
}

export function renderProjectExport(
  name: string,
  details: SessionDetail[],
  format: 'html' | 'markdown'
): { body: string; defaultName: string } {
  const defaultName = sanitizeFileName(name)
  const markdown = [`# ${name}`, ...details.map((detail) => renderMarkdown(detail))].join(
    '\n\n---\n\n'
  )
  return {
    defaultName,
    body: format === 'html' ? renderHtmlDocument(defaultName, markdown) : markdown
  }
}

function sanitizeFileName(name: string): string {
  return name.replace(/[/\\:*?"<>|]+/g, '-').slice(0, 80) || 'session'
}

function renderMarkdown(detail: SessionDetail): string {
  const title = detail.info?.name || detail.sessionId
  const lines = [`# ${title}`, '', `_cwd: ${detail.info?.cwd ?? ''}_`, '']
  for (const message of detail.context.messages) {
    lines.push(renderMessageMarkdown(message), '')
  }
  return lines.join('\n')
}

function renderHtmlDocument(title: string, markdown: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
</head>
<body>
  <pre>${escapeHtml(markdown)}</pre>
</body>
</html>
`
}

function renderMessageMarkdown(message: AgentMessage): string {
  if (message.role === 'user') {
    const text =
      typeof message.content === 'string'
        ? message.content
        : message.content
            .map((block) =>
              block.type === 'text' ? block.text : `[Image: ${block.mimeType || 'image'}]`
            )
            .join('\n\n')
    return `## User\n\n${text}`
  }
  if (message.role === 'assistant') {
    const parts = message.content.map((block) => {
      if (block.type === 'text') return block.text
      if (block.type === 'thinking') {
        return `> thinking\n>\n> ${block.thinking.replace(/\n/g, '\n> ')}`
      }
      if (block.type === 'image') return `[Image: ${block.mimeType || 'image'}]`
      if (block.type === 'toolCall') {
        return `\`\`\`tool ${block.toolName}\n${JSON.stringify(block.input, null, 2)}\n\`\`\``
      }
      return ''
    })
    return `## Assistant (${message.provider}/${message.model})\n\n${parts.join('\n\n')}`
  }
  if (message.role === 'toolResult') {
    const text = message.content
      .filter((block) => block.type === 'text')
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('\n')
    return `### Tool result${message.isError ? ' (error)' : ''}\n\n\`\`\`\n${text}\n\`\`\``
  }
  if (message.role === 'bashExecution') {
    return `### bash\n\n\`\`\`\n$ ${message.command}\n${message.output}\n\`\`\``
  }
  const content =
    typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
  return `### ${message.customType}\n\n${content}`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

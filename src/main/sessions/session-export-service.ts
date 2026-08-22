import { BrowserWindow, dialog } from 'electron'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { AgentMessage, SessionDetail } from '@shared/types/workspace'
import type { SessionService } from './session-service'

export class SessionExportService {
  constructor(private readonly sessions: SessionService) {}

  async exportToFile(
    sessionId: string,
    format: 'html' | 'markdown',
    defaultName?: string
  ): Promise<string | null> {
    const detail = await this.sessions.get(sessionId)
    const body = format === 'html' ? renderHtml(detail) : renderMarkdown(detail)
    const ext = format === 'html' ? 'html' : 'md'
    const result = await dialog.showSaveDialog({
      defaultPath: `${sanitizeFileName(defaultName || detail.info?.name || sessionId)}.${ext}`,
      filters:
        format === 'html'
          ? [{ name: 'HTML', extensions: ['html'] }]
          : [{ name: 'Markdown', extensions: ['md'] }]
    })
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, body, 'utf8')
    return result.filePath
  }

  async viewFullHistory(sessionId: string, parent?: BrowserWindow | null): Promise<void> {
    const detail = await this.sessions.getFullHistory(sessionId)
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'pi-harness-history-'))
    const filePath = path.join(tempDir, `${sanitizeFileName(detail.info?.name || sessionId)}.html`)
    await writeFile(filePath, renderHtml(detail), 'utf8')

    const win = new BrowserWindow({
      width: 1040,
      height: 760,
      minWidth: 720,
      minHeight: 520,
      show: false,
      title: detail.info?.name || sessionId,
      ...(parent ? { parent } : {}),
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true
      }
    })
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (event) => event.preventDefault())
    win.once('ready-to-show', () => win.show())
    win.once('closed', () => {
      void rm(tempDir, { recursive: true, force: true })
    })
    try {
      await win.loadFile(filePath)
    } catch (error) {
      win.destroy()
      await rm(tempDir, { recursive: true, force: true })
      throw error
    }
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

function renderHtml(detail: SessionDetail): string {
  const md = renderMarkdown(detail)
  const escaped = escapeHtml(md)
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(detail.info?.name || detail.sessionId)}</title>
  <style>
    :root { color-scheme: light dark; }
    body { font-family: ui-sans-serif, system-ui, sans-serif; max-width: 920px; margin: 40px auto; padding: 0 24px; color: CanvasText; background: Canvas; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; background: color-mix(in srgb, CanvasText 6%, Canvas); padding: 18px; border-radius: 10px; line-height: 1.6; }
  </style>
</head>
<body>
  <pre>${escaped}</pre>
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
              block.type === 'text' ? block.text : `[Image: ${block.source.media_type ?? 'image'}]`
            )
            .join('\n\n')
    return `## User\n\n${text}`
  }
  if (message.role === 'assistant') {
    const parts = message.content.map((block) => {
      if (block.type === 'text') return block.text
      if (block.type === 'thinking')
        return `> thinking\n>\n> ${block.thinking.replace(/\n/g, '\n> ')}`
      if (block.type === 'image') return `[Image: ${block.source.media_type ?? 'image'}]`
      if (block.type === 'toolCall') {
        return `\`\`\`tool ${block.toolName}\n${JSON.stringify(block.input, null, 2)}\n\`\`\``
      }
      return ''
    })
    return `## Assistant (${message.provider}/${message.model})\n\n${parts.join('\n\n')}`
  }
  if (message.role === 'toolResult') {
    const text = message.content
      .filter((b) => b.type === 'text')
      .map((b) => (b.type === 'text' ? b.text : ''))
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

export function exportDefaultDirHint(filePath: string): string {
  return path.dirname(filePath)
}

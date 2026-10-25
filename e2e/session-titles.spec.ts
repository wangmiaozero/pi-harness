import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { test as base, expect } from './fixtures'
import { IPC_INVOKE } from '../src/shared/ipc/channels'

const id = 'title-summary-session'
const requests: Array<Record<string, unknown>> = []
const test = base.extend({
  piAgentDir: async ({ testUserData, workspaceRoot }, use) => {
    const server = http.createServer(async (request, response) => {
      let body = ''
      for await (const chunk of request) body += chunk
      const input = JSON.parse(body)
      requests.push(input)
      const text = '修复会话切换状态'
      if (input.stream) {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' })
        for (const part of [
          { delta: { role: 'assistant', content: text }, finish_reason: null },
          { delta: {}, finish_reason: 'stop' }
        ])
          response.write(
            `data: ${JSON.stringify({ id: 'title', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, ...part }] })}\n\n`
          )
        response.end('data: [DONE]\n\n')
      } else {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(
          JSON.stringify({
            id: 'title',
            object: 'chat.completion',
            created: 1,
            model: 'fixture',
            choices: [
              { index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }
            ],
            usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 }
          })
        )
      }
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as { port: number }).port
    const agentDir = path.join(testUserData, 'mock-pi')
    fs.cpSync(path.resolve('fixtures/mock-pi'), agentDir, { recursive: true })
    fs.writeFileSync(
      path.join(agentDir, 'settings.json'),
      JSON.stringify({ defaultProvider: 'fixture', defaultModel: 'fixture' })
    )
    fs.writeFileSync(
      path.join(agentDir, 'models.json'),
      JSON.stringify({
        providers: {
          fixture: {
            api: 'openai-completions',
            apiKey: 'local-placeholder',
            baseUrl: `http://127.0.0.1:${port}/v1`,
            models: [
              {
                id: 'fixture',
                name: 'Fixture model',
                input: ['text'],
                reasoning: false,
                contextWindow: 128000,
                maxTokens: 4096
              }
            ]
          }
        }
      })
    )
    const dir = path.join(
      agentDir,
      'sessions',
      `--${workspaceRoot.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`
    )
    fs.mkdirSync(dir, { recursive: true })
    const timestamp = '2026-10-25T03:00:00.000Z'
    fs.writeFileSync(
      path.join(dir, `2026-10-25T03-00-00-000Z_${id}.jsonl`),
      [
        { type: 'session', version: 3, id, cwd: workspaceRoot, timestamp },
        {
          type: 'model_change',
          id: 'model',
          parentId: null,
          provider: 'fixture',
          modelId: 'fixture',
          timestamp
        },
        {
          type: 'message',
          id: 'user',
          parentId: 'model',
          timestamp,
          message: {
            role: 'user',
            content:
              'https://github.com/example/demo\n请修复切换会话多次后，旧响应覆盖当前会话草稿和项目目录的问题。'
          }
        },
        {
          type: 'message',
          id: 'assistant',
          parentId: 'user',
          timestamp,
          message: {
            role: 'assistant',
            provider: 'fixture',
            model: 'fixture',
            stopReason: 'stop',
            content: [
              {
                type: 'text',
                text: '可以从会话切换的异步响应入手，使用会话标识和请求版本检查过期结果，确保草稿、项目目录与当前会话保持一致。'.repeat(
                  3
                )
              },
              { type: 'thinking', thinking: 'private model reasoning' }
            ]
          }
        }
      ]
        .map((entry) => JSON.stringify(entry))
        .join('\n') + '\n'
    )
    try {
      await use(agentDir)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
})

test('summarizes a conversation, refreshes navigation and preserves a manual name after reload', async ({
  page,
  electronApp
}) => {
  await page.evaluate(
    (id) =>
      localStorage.setItem(
        'pi-harness.workspace.v1',
        JSON.stringify({
          projectKey: null,
          pickedCwd: null,
          projectRoots: [],
          tabs: [
            {
              id: `chat:${id}`,
              kind: 'chat',
              title: 'Conversation',
              sessionId: id,
              closable: false
            }
          ],
          activeTabId: `chat:${id}`
        })
      ),
    id
  )
  await page.locator('a[href="#/workspace"]').click()
  const row = page.getByTestId(`session-row-${id}`)
  await expect(row).toContainText('修复会话切换状态', { timeout: 30_000 })
  expect(requests).toHaveLength(1)
  expect(JSON.stringify(requests[0])).not.toContain('private model reasoning')
  expect(requests[0].tools ?? []).toEqual([])
  const detail = await page.evaluate((id) => window.piSwitch.sessions.get(id), id)
  expect(detail.info?.name).toBe('修复会话切换状态')
  await electronApp.evaluate(({ ipcMain }, channel) => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, () => ({ ok: true, data: 'rename' }))
  }, IPC_INVOKE.sessionContextMenu)
  await row.click({ button: 'right' })
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox').fill('我的排查记录')
  await dialog.getByRole('button', { name: /保存|Save/ }).click()
  await expect(row).toContainText('我的排查记录')
  await page.reload()
  await expect(row).toContainText('我的排查记录')
  const renamed = await page.evaluate((id) => window.piSwitch.sessions.get(id), id)
  expect(renamed.info?.name).toBe('我的排查记录')
  expect(requests).toHaveLength(1)
})

import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { test as base, expect } from './fixtures'
import { IPC_INVOKE } from '../src/shared/ipc/channels'

const id = 'title-summary-session'
const requests: Array<Record<string, unknown>> = []
const test = base.extend<{ titleAvailable: boolean }>({
  titleAvailable: [true, { option: true }],
  piAgentDir: async ({ testUserData, workspaceRoot, titleAvailable }, use) => {
    requests.splice(0)
    const server = http.createServer(async (request, response) => {
      let body = ''
      for await (const chunk of request) body += chunk
      const input = JSON.parse(body)
      requests.push(input)
      if (!titleAvailable) {
        response.writeHead(503)
        response.end('Title service unavailable')
        return
      }
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
              '| **agent-admin** | `/agent-admin` | 管理端 |\n| --- | --- | --- |\nhttps://github.com/example/demo\n请修复切换会话多次后，旧响应覆盖当前会话草稿和项目目录的问题。'
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
            usage: {
              input: 20,
              output: 20,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 40,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
            },
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
  const preview = await page.evaluate(async (id) => {
    const sessions = await window.piSwitch.sessions.list(true)
    return sessions.find((session) => session.id === id)?.name
  }, id)
  expect(preview).toBe('修复切换会话多次后')
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
  await page.getByTestId('workspace-toggle-files').click()
  await expect(page.getByTestId('workspace-files-session-title')).toHaveText('修复会话切换状态')
  await electronApp.evaluate(({ ipcMain }, channel) => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, () => ({ ok: true, data: 'rename' }))
  }, IPC_INVOKE.sessionContextMenu)
  await row.click({ button: 'right' })
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox').fill('我的排查记录')
  await dialog.getByRole('button', { name: /保存|Save/ }).click()
  await expect(row).toContainText('我的排查记录')
  await expect(page.getByTestId('workspace-files-session-title')).toHaveText('我的排查记录')
  await page.reload()
  await expect(row).toContainText('我的排查记录')
  const renamed = await page.evaluate((id) => window.piSwitch.sessions.get(id), id)
  expect(renamed.info?.name).toBe('我的排查记录')
  expect(requests).toHaveLength(1)
})

test.describe('title fallback and constrained workspace layout', () => {
  test.use({ titleAvailable: false })

  test('keeps plain titles, historical model names and file controls readable', async ({
    page
  }, testInfo) => {
    // Keep the configured/current model but remove it from selectable model rows.
    await page.evaluate(async () => {
      const model = (await window.piSwitch.models.list()).find(
        (model) => model.modelId === 'fixture'
      )!
      await window.piSwitch.models.update(model.id, { ...model, enabled: false })
    })
    await page.locator('a[href="#/workspace"]').click()
    const row = page.getByTestId(`session-row-${id}`)
    await row.click()
    await expect(row).toContainText('修复切换会话多次后')
    await page.getByTestId('workspace-toggle-files').click()
    const title = page.getByTestId('workspace-files-session-title')
    await expect(title).toHaveText('修复切换会话多次后')
    await expect.poll(() => requests.length).toBe(1)
    // A failed background summary preserves the useful local title without Markdown.
    await expect(title).not.toContainText(/[|*`]/)
    const trigger = page.getByTestId('workspace-model-select').getByRole('button')
    await expect(page.getByTestId('composer-model-name')).toHaveText('fixture')

    // A manually named, long conversation must not squeeze the Files label/actions.
    const longTitle = '排查管理端日志查询响应速度并优化列表数据加载与展示'.repeat(3)
    await page.evaluate(({ id, name }) => window.piSwitch.sessions.rename(id, name), {
      id,
      name: longTitle
    })
    await page.getByTestId('workspace-refresh').click()
    await expect(title).toHaveText(longTitle)
    for (const width of [1600, 1280, 1000]) {
      await page.setViewportSize({ width, height: 900 })
      const metrics = await page.getByTestId('workspace-files-header').evaluate((header) => {
        const label = header.querySelector('[data-testid="workspace-files-label"]')!
        const title = header.querySelector('[data-testid="workspace-files-session-title"]')!
        const box = header.getBoundingClientRect()
        const range = document.createRange()
        range.selectNodeContents(label)
        const actions = header.lastElementChild!.getBoundingClientRect()
        return {
          lines: range.getClientRects().length,
          titleRight: title.getBoundingClientRect().right,
          actionsLeft: actions.left,
          actionsRight: actions.right,
          headerRight: box.right,
          overflow: header.scrollWidth - header.clientWidth
        }
      })
      expect(metrics.lines).toBe(1)
      expect(metrics.titleRight).toBeLessThanOrEqual(metrics.actionsLeft)
      expect(metrics.actionsRight).toBeLessThanOrEqual(metrics.headerRight)
      expect(metrics.overflow).toBeLessThanOrEqual(1)
      const composer = page.getByTestId('chat-composer')
      const layout = await composer.evaluate((composer) => {
        const controls = composer.querySelector('.command-console-controls')!
        const name = composer.querySelector('[data-testid="composer-model-name"]')!
        const picker = composer.querySelector('[data-testid="workspace-model-select"]')!
        const send = composer.querySelector('.command-execute-button')!
        const rect = controls.getBoundingClientRect()
        const pickerRect = picker.getBoundingClientRect()
        const sendRect = send.getBoundingClientRect()
        const toolsRect = controls.querySelector('.composer-tools')!.getBoundingClientRect()
        const range = document.createRange()
        range.selectNodeContents(name)
        return {
          nameWidth: name.getBoundingClientRect().width,
          textWidth: range.getBoundingClientRect().width,
          modelIconVisible: picker.querySelector('svg')!.getBoundingClientRect().width > 0,
          tooltip: picker.querySelector('button')!.title,
          controlsWidth: rect.width,
          sameRow:
            Math.abs(
              (toolsRect.top + toolsRect.bottom) / 2 - (pickerRect.top + pickerRect.bottom) / 2
            ) < 2,
          overflow: controls.scrollWidth - controls.clientWidth,
          pickerInside: pickerRect.left >= rect.left && pickerRect.right <= rect.right,
          sendInside: sendRect.left >= rect.left && sendRect.right <= rect.right,
          overlap:
            Math.min(pickerRect.right, sendRect.right) > Math.max(pickerRect.left, sendRect.left) &&
            Math.min(pickerRect.bottom, sendRect.bottom) > Math.max(pickerRect.top, sendRect.top)
        }
      })
      if (layout.nameWidth > 0)
        expect(layout.nameWidth + 1).toBeGreaterThanOrEqual(Math.min(60, layout.textWidth))
      expect(layout.modelIconVisible).toBe(true)
      expect(layout.tooltip).toContain('fixture')
      if (layout.nameWidth === 0 && layout.controlsWidth >= 325) expect(layout.sameRow).toBe(true)
      expect(layout.overflow).toBeLessThanOrEqual(1)
      expect(layout.pickerInside).toBe(true)
      expect(layout.sendInside).toBe(true)
      expect(layout.overlap).toBe(false)
      await expect(page.getByTestId('workspace-collapse-files')).toBeVisible()
      await expect(trigger).toContainText('fixture')
      await page.screenshot({ path: testInfo.outputPath(`workspace-layout-${width}.png`) })
    }
  })
})

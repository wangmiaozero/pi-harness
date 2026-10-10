import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { execFileSync } from 'node:child_process'
import { test, expect } from './fixtures'

test('browses without model calls, previews evidence, and continues through the real Pi SDK', async ({
  page,
  testUserData,
  workspaceRoot,
  piAgentDir
}, testInfo) => {
  const projectRoot = path.join(fs.realpathSync(workspaceRoot), 'main')
  const extraRoot = path.join(fs.realpathSync(workspaceRoot), 'docs')
  fs.mkdirSync(projectRoot)
  fs.mkdirSync(extraRoot)
  const recordedCwd = path.join(projectRoot, 'src')
  fs.mkdirSync(recordedCwd)
  execFileSync('git', ['init', projectRoot], { stdio: 'ignore' })
  fs.writeFileSync(path.join(extraRoot, 'note.md'), 'Extra project source verified\n')
  const requests: Record<string, unknown>[] = []
  const server = http.createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    requests.push(JSON.parse(body))
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
    const tool = requests.length <= 2
    const delta = tool
      ? {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: `call-read-${requests.length}`,
              type: 'function',
              function: {
                name: 'read',
                arguments: JSON.stringify({
                  path:
                    requests.length === 1
                      ? path.join(projectRoot, 'a.ts')
                      : path.join(extraRoot, 'note.md')
                })
              }
            }
          ]
        }
      : {
          role: 'assistant',
          content: 'Pi continuation verified: read a.ts from the linked workspace.'
        }
    response.write(
      `data: ${JSON.stringify({ id: 'chatcmpl-local-test', object: 'chat.completion.chunk', created: 1, model: 'gpt-4o', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`
    )
    response.write(
      `data: ${JSON.stringify({ id: 'chatcmpl-local-test', object: 'chat.completion.chunk', created: 1, model: 'gpt-4o', choices: [{ index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }] })}\n\n`
    )
    response.end('data: [DONE]\n\n')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  const source = path.join(testUserData, 'history-home', '.claude', 'projects', 'fixture-project')
  fs.mkdirSync(source, { recursive: true })
  fs.writeFileSync(path.join(projectRoot, 'a.ts'), 'export const value = 42\n')
  const originalPath = path.join(source, 'external-session.jsonl')
  const original =
    [
      {
        type: 'user',
        uuid: 'u1',
        sessionId: 'external-session',
        cwd: recordedCwd,
        timestamp: '2026-10-01T10:00:00.000Z',
        message: { role: 'user', content: 'Universal history fixture 中文' }
      },
      {
        type: 'assistant',
        uuid: 'a1',
        timestamp: '2026-10-01T10:01:00.000Z',
        message: {
          role: 'assistant',
          content: '已完成初步分析，测试通过。下一步：检查 a.ts。',
          usage: { input_tokens: 10, output_tokens: 5 }
        }
      },
      {
        type: 'assistant',
        uuid: 'a2',
        timestamp: '2026-10-01T10:02:00.000Z',
        message: {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'historic-read', name: 'Read', input: { file_path: 'a.ts' } }
          ]
        }
      }
    ]
      .map((r) => JSON.stringify(r))
      .join('\n') + '\n'
  fs.writeFileSync(originalPath, original)
  fs.writeFileSync(
    path.join(piAgentDir, 'models.json'),
    JSON.stringify({
      providers: {
        'openai-compatible': {
          api: 'openai-completions',
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          apiKey: 'local-test-placeholder',
          models: [
            {
              id: 'gpt-4o',
              name: 'Local fixture',
              reasoning: false,
              input: ['text'],
              contextWindow: 128000,
              maxTokens: 4096
            }
          ]
        }
      }
    })
  )
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  try {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.evaluate(
      ({ projectRoot, extraRoot }) => {
        const key = 'pi-harness.workspace.v1'
        const current = JSON.parse(localStorage.getItem(key) ?? '{}')
        localStorage.setItem(
          key,
          JSON.stringify({
            ...current,
            importedProjectRoots: [projectRoot],
            projectSettings: {
              [projectRoot]: { name: 'Combined project', roots: [projectRoot, extraRoot] }
            }
          })
        )
      },
      { projectRoot, extraRoot }
    )
    await page.locator('a[href="#/ai-sessions"]').click()
    await expect(page.getByText('Universal history fixture 中文', { exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByText('Universal history fixture 中文', { exact: true })).toBeVisible()
    await page.getByTestId('history-provider-codex').click()
    await expect(page.getByText('Universal history fixture 中文', { exact: true })).toHaveCount(0)
    await page.getByTestId('history-provider-claude').click()
    await page.getByRole('textbox', { name: /搜索聊天记录|Search conversations/ }).fill('初步分析')
    await expect(page.getByText('Universal history fixture 中文', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: /查看历史|View history/, exact: true }).click()
    await expect(page.getByTestId('history-messages')).toContainText('已完成初步分析')
    expect(requests).toHaveLength(0)
    await page.getByTestId('history-continue-task').click()
    await page
      .getByRole('textbox', { name: /接下来希望 Pi 做什么|What should Pi do next/ })
      .fill('Read a.ts and explain its contents. Do not change files.')
    await page.getByRole('button', { name: /生成任务交接|Prepare handoff/, exact: true }).click()
    await expect(page.getByTestId('handoff-preview')).toContainText(
      /尚未验证当前项目|Current tests have not been verified/
    )
    await expect(page.getByTestId('handoff-preview')).toContainText('历史声称已完成')
    await expect(page.getByTestId('handoff-preview')).toContainText(extraRoot)
    expect(requests).toHaveLength(0)
    await page.screenshot({ path: path.join(testInfo.outputDir, 'universal-handoff.png') })
    await page.getByTestId('handoff-confirm').click()
    await expect(page.getByTestId('pi-task-origin')).toContainText('claude', { timeout: 30_000 })
    await expect(page.getByTestId('chat-window')).toContainText('Pi continuation verified', {
      timeout: 30_000
    })
    expect(requests.length).toBeGreaterThanOrEqual(3)
    expect(JSON.stringify(requests)).toContain('export const value = 42')
    expect(JSON.stringify(requests)).toContain('Extra project source verified')
    const sessions = await page.evaluate(() => window.piSwitch!.sessions.list(true))
    const canonicalWorkspace = fs.realpathSync(projectRoot)
    const continued = sessions.find((s) => s.cwd === canonicalWorkspace)
    expect(continued).toBeDefined()
    const bindings = await page.evaluate(() => window.piSwitch!.workspace.listSessionBindings())
    expect(bindings[continued!.id]?.folders.map((f) => f.path)).toEqual([
      canonicalWorkspace,
      fs.realpathSync(extraRoot)
    ])
    const native = fs.readFileSync(continued!.path, 'utf8')
    expect(JSON.parse(native.split('\n')[0]!)).toMatchObject({
      type: 'session',
      cwd: canonicalWorkspace
    })
    expect(native).toContain('Source Conversation Data')
    expect(native).toContain('external-session') // included in native history as traceable source path.
    expect(fs.readFileSync(originalPath, 'utf8')).toBe(original)
    await page.evaluate(() => window.piSwitch!.universal.clear())
    expect(fs.readFileSync(originalPath, 'utf8')).toBe(original)
    expect(fs.existsSync(continued!.path)).toBe(true)
    const requestCount = requests.length
    await page.getByTestId('pi-task-origin').locator('a').click()
    await expect(page.getByTestId('history-messages')).toContainText('已完成初步分析')
    expect(requests).toHaveLength(requestCount)
    expect(fs.readFileSync(originalPath, 'utf8')).toBe(original)
    expect(errors).toEqual([])
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('rejects arbitrary read paths and unknown IPC fields and keeps cached history across reload', async ({
  page,
  testUserData,
  workspaceRoot
}) => {
  const source = path.join(testUserData, 'history-home', '.codex', 'sessions')
  fs.mkdirSync(source, { recursive: true })
  fs.writeFileSync(
    path.join(source, 'rollout-fixture.jsonl'),
    [
      { type: 'session_meta', payload: { id: 'codex-fixture', cwd: workspaceRoot } },
      {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: 'Codex cached history' },
            {
              type: 'input_image',
              image_url: `data:image/png;base64,${'a'.repeat(5 * 1024 * 1024)}`
            }
          ]
        }
      },
      {
        type: 'response_item',
        payload: {
          type: 'custom_tool_call_output',
          call_id: 'long-output',
          output: 'x'.repeat(200_000)
        }
      }
    ]
      .map((r) => JSON.stringify(r))
      .join('\n')
  )
  const historyHome = path.join(testUserData, 'history-home')
  const cursorRoot =
    process.platform === 'darwin'
      ? path.join(historyHome, 'Library', 'Application Support', 'Cursor', 'User')
      : process.platform === 'win32'
        ? path.join(historyHome, 'AppData', 'Roaming', 'Cursor', 'User')
        : path.join(historyHome, '.config', 'Cursor', 'User')
  const cursorStorage = path.join(cursorRoot, 'globalStorage')
  fs.mkdirSync(cursorStorage, { recursive: true })
  const cursorDb = new DatabaseSync(path.join(cursorStorage, 'state.vscdb'))
  cursorDb.exec('CREATE TABLE cursorDiskKV(key TEXT PRIMARY KEY, value TEXT)')
  const put = cursorDb.prepare('INSERT INTO cursorDiskKV VALUES (?, ?)')
  put.run(
    'composerData:cursor-fixture',
    JSON.stringify({
      name: 'Cursor SQLite fixture',
      workspaceIdentifier: { uri: { fsPath: workspaceRoot } },
      fullConversationHeadersOnly: [{ bubbleId: 'bubble', type: 1 }]
    })
  )
  put.run('bubbleId:cursor-fixture:bubble', JSON.stringify({ text: 'SQLite worker history 中文' }))
  cursorDb.close()
  await page.locator('a[href="#/ai-sessions"]').click()
  await expect(page.getByText('Codex cached history', { exact: true })).toBeVisible()
  await page.getByTestId('history-provider-cursor').click()
  await expect(page.getByText('Codex cached history', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Cursor SQLite fixture', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /查看历史|View history/, exact: true }).click()
  await expect(page.getByTestId('history-messages')).toContainText('SQLite worker history 中文')
  const denied = await page.evaluate(async () => {
    const result: boolean[] = []
    for (const request of [{ id: '../settings.json' }, { id: 'a'.repeat(64), path: '/tmp' }]) {
      try {
        await window.piSwitch!.universal.read(request)
        result.push(false)
      } catch {
        result.push(true)
      }
    }
    return result
  })
  expect(denied).toEqual([true, true])
  await page.reload()
  await expect(page.getByText('Codex cached history', { exact: true })).toBeVisible()
  await page.getByTestId('history-provider-codex').click()
  await expect(page.getByText('Cursor SQLite fixture', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: /查看历史|View history/, exact: true }).click()
  await expect(page.getByTestId('history-messages')).toContainText('Codex cached history')
})

test('keeps history below Git for saved navigation and filters dates with the themed calendar', async ({
  page,
  testUserData,
  workspaceRoot
}, testInfo) => {
  const now = new Date()
  const older = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 3, 12)
  const isoDay = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  const source = path.join(testUserData, 'history-home', '.codex', 'sessions')
  fs.mkdirSync(source, { recursive: true })
  for (const [id, date] of [
    ['older', older],
    ['newer', now]
  ] as const)
    fs.writeFileSync(
      path.join(source, `${id}.jsonl`),
      JSON.stringify({
        type: 'response_item',
        timestamp: date.toISOString(),
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: `Calendar history ${id}` }]
        }
      }) + '\n'
    )
  await page.evaluate(() =>
    window.piSwitch!.settings.set({
      theme: 'light',
      navOrder: ['workspace', 'git', 'models', 'skills', 'settings']
    })
  )
  await page.reload()
  await expect(page.getByTestId('startup-animation')).toBeHidden({ timeout: 12_000 })
  const order = await page
    .getByTestId('app-navigation-rail')
    .locator('a')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href')))
  expect(order.indexOf('#/ai-sessions')).toBe(order.indexOf('#/git') + 1)
  await page.locator('a[href="#/ai-sessions"]').click()
  await page.getByTestId('history-provider-codex').click()
  await expect(page.getByText('Calendar history newer', { exact: true })).toBeVisible()
  await expect(page.getByText('Calendar history older', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /起始日期|From date/, exact: true }).click()
  const start = page.getByRole('dialog', { name: /起始日期|From date/, exact: true })
  await expect(start).toBeVisible()
  await expect(start).toBeInViewport({ timeout: 5000 })
  await page.screenshot({ path: path.join(testInfo.outputDir, 'history-calendar-light.png') })
  if (older.getMonth() !== now.getMonth())
    await start.getByRole('button', { name: /上个月|Previous month/ }).click()
  await start.locator(`[data-value="${isoDay(older)}"]:not([data-outside-view])`).click()
  await expect(start).toBeHidden()
  await page.getByRole('button', { name: /结束日期|To date/, exact: true }).click()
  const end = page.getByRole('dialog', { name: /结束日期|To date/, exact: true })
  if (older.getMonth() !== now.getMonth())
    await end.getByRole('button', { name: /上个月|Previous month/ }).click()
  await end.locator(`[data-value="${isoDay(older)}"]:not([data-outside-view])`).click()
  await expect(page.getByText('Calendar history newer', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Calendar history older', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /结束日期|To date/, exact: true }).click()
  const selected = end.locator('[data-selected]:not([data-outside-view])')
  await selected.press('ArrowRight')
  await page.keyboard.press('Enter')
  await expect(end).toBeHidden()
  await page.getByRole('button', { name: /结束日期|To date/, exact: true }).click()
  await end.getByRole('button', { name: /清除日期|Clear date/ }).click()
  await expect(page.getByText('Calendar history newer', { exact: true })).toBeVisible()
  await page.evaluate(() => window.piSwitch!.settings.set({ theme: 'dark' }))
  await page.reload()
  await expect(page.getByTestId('startup-animation')).toBeHidden({ timeout: 12_000 })
  await page.getByRole('button', { name: /起始日期|From date/, exact: true }).click()
  await expect(start).toBeVisible()
  await expect(start).toBeInViewport()
  await page.screenshot({ path: path.join(testInfo.outputDir, 'history-calendar-dark.png') })
  await page.keyboard.press('Escape')
  await expect(start).toBeHidden()
})

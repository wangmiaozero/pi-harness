import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { test, expect } from './fixtures'

test('browses without model calls, previews evidence, and continues through the real Pi SDK', async ({
  page,
  testUserData,
  workspaceRoot,
  piAgentDir
}, testInfo) => {
  const requests: Record<string, unknown>[] = []
  const server = http.createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    requests.push(JSON.parse(body))
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
    const tool = requests.length === 1
    const delta = tool
      ? {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: 'call-read',
              type: 'function',
              function: {
                name: 'read',
                arguments: JSON.stringify({ path: path.join(workspaceRoot, 'a.ts') })
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
  fs.writeFileSync(path.join(workspaceRoot, 'a.ts'), 'export const value = 42\n')
  const originalPath = path.join(source, 'external-session.jsonl')
  const original =
    [
      {
        type: 'user',
        uuid: 'u1',
        sessionId: 'external-session',
        cwd: workspaceRoot,
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
    await page.locator('a[href="#/ai-sessions"]').click()
    await expect(page.getByText('Universal history fixture 中文', { exact: true })).toBeVisible()
    await page.getByTestId('history-provider-codex').click()
    await expect(page.getByText('Universal history fixture 中文', { exact: true })).toHaveCount(0)
    await page.getByTestId('history-provider-claude').click()
    await page.getByRole('textbox', { name: /搜索聊天记录|Search conversations/ }).fill('初步分析')
    await expect(page.getByText('Universal history fixture 中文', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: /查看历史|View history/, exact: true }).click()
    await expect(page.getByTestId('history-messages')).toContainText('已完成初步分析')
    expect(requests).toHaveLength(0)
    const id = await page.evaluate(
      async () =>
        (await window.piSwitch!.universal.list()).sessions.find(
          (s) => s.nativeSessionId === 'external-session'
        )!.id
    )
    await page.evaluate(
      async ({ id, workspaceRoot }) => {
        await window.piSwitch!.universal.map(id, workspaceRoot)
      },
      { id, workspaceRoot }
    )
    // Reload details so the page sees the Main-owned mapping.
    await page.getByRole('button', { name: /查看历史|View history/, exact: true }).click()
    await page.getByTestId('history-continue-task').click()
    await page
      .getByRole('textbox', { name: /接下来希望 Pi 做什么|What should Pi do next/ })
      .fill('Read a.ts and explain its contents. Do not change files.')
    await page.getByRole('button', { name: /生成任务交接|Prepare handoff/, exact: true }).click()
    await expect(page.getByTestId('handoff-preview')).toContainText(
      /尚未验证当前项目|Current tests have not been verified/
    )
    await expect(page.getByTestId('handoff-preview')).toContainText('历史声称已完成')
    expect(requests).toHaveLength(0)
    await page.screenshot({ path: path.join(testInfo.outputDir, 'universal-handoff.png') })
    await page.getByTestId('handoff-confirm').click()
    await expect(page.getByTestId('pi-task-origin')).toContainText('claude', { timeout: 30_000 })
    await expect(page.getByTestId('chat-window')).toContainText('Pi continuation verified', {
      timeout: 30_000
    })
    expect(requests.length).toBeGreaterThanOrEqual(2)
    expect(JSON.stringify(requests)).toContain('export const value = 42')
    const sessions = await page.evaluate(() => window.piSwitch!.sessions.list(true))
    const canonicalWorkspace = fs.realpathSync(workspaceRoot)
    const continued = sessions.find((s) => s.cwd === canonicalWorkspace)
    expect(continued).toBeDefined()
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
          content: [{ type: 'input_text', text: 'Codex cached history' }]
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

import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { execFileSync } from 'node:child_process'
import { test, expect } from './fixtures'

test('continues a Codex conversation in its recorded directory without importing a project', async ({
  page,
  testUserData,
  piAgentDir
}, testInfo) => {
  // Outside the fixture's preauthorized workspace: browsing and resolving must not grant access.
  const project = path.join(fs.realpathSync(testUserData), 'unimported-project')
  fs.mkdirSync(project)
  const source = path.join(testUserData, 'history-home', '.codex', 'sessions')
  fs.mkdirSync(source, { recursive: true })
  const originalPath = path.join(source, 'recorded-project.jsonl')
  const original =
    [
      { type: 'session_meta', payload: { id: 'recorded-project', cwd: project } },
      {
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Continue in the existing Codex project' }]
        }
      }
    ]
      .map((r) => JSON.stringify(r))
      .join('\n') + '\n'
  fs.writeFileSync(originalPath, original)
  const requests: unknown[] = []
  const server = http.createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    requests.push(JSON.parse(body))
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.write(
      `data: ${JSON.stringify({ id: 'chatcmpl-recorded', object: 'chat.completion.chunk', created: 1, model: 'gpt-4o', choices: [{ index: 0, delta: { role: 'assistant', content: 'Recorded project continuation confirmed.' }, finish_reason: null }] })}\n\n`
    )
    response.write(
      `data: ${JSON.stringify({ id: 'chatcmpl-recorded', object: 'chat.completion.chunk', created: 1, model: 'gpt-4o', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`
    )
    response.end('data: [DONE]\n\n')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
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
  const roots = () =>
    JSON.parse(fs.readFileSync(path.join(testUserData, 'authorized-roots.json'), 'utf8'))
      .roots as string[]
  try {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.evaluate(() => window.piSwitch!.settings.set({ theme: 'macos27-light' }))
    await page.reload()
    await expect(page.getByTestId('startup-animation')).toBeHidden({ timeout: 12_000 })
    await page.locator('a[href="#/ai-sessions"]').click()
    await page.getByTestId('history-provider-codex').click()
    const card = page
      .getByTestId('history-session-list')
      .getByRole('button', { name: /Continue in the existing Codex project/ })
    await card.click()
    expect(roots()).not.toContain(project)
    const listed = await page.evaluate(() => window.piSwitch!.universal.list({ provider: 'codex' }))
    const item = listed.sessions.find((s) => s.nativeSessionId === 'recorded-project')!
    expect(item.workspacePath).toBeUndefined()
    await page.getByTestId('history-continue-task').click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByTestId('handoff-project-path')).toHaveText(project)
    await expect(dialog.getByRole('combobox')).toHaveCount(0)
    await expect(
      dialog.getByRole('button', { name: /保存项目关联|Save project link/ })
    ).toHaveCount(0)
    expect(roots()).not.toContain(project)
    expect(requests).toHaveLength(0)
    await page.screenshot({ path: path.join(testInfo.outputDir, 'recorded-project-ready.png') })
    // Even a valid history ID cannot grant a different renderer-supplied directory.
    const denied = await page.evaluate(
      async ({ id, folder }) => {
        try {
          await window.piSwitch!.universal.map(id, folder)
          return false
        } catch {
          return true
        }
      },
      { id: item.id, folder: fs.realpathSync(testUserData) }
    )
    expect(denied).toBe(true)
    await dialog
      .getByRole('textbox', { name: /接下来希望 Pi 做什么|What should Pi do next/ })
      .fill('Continue this task in the recorded project. Do not modify files.')
    const prepare = dialog.getByRole('button', {
      name: /生成任务交接|Prepare handoff/,
      exact: true
    })
    const radius = await prepare.evaluate((button) => getComputedStyle(button).borderTopLeftRadius)
    expect(parseFloat(radius)).toBeGreaterThan(0)
    await page.keyboard.press('Tab')
    await prepare.focus()
    await expect(prepare).toBeFocused()
    expect(await prepare.evaluate((button) => button.matches(':focus-visible'))).toBe(true)
    expect(await prepare.evaluate((button) => getComputedStyle(button).borderTopLeftRadius)).toBe(
      radius
    )
    await prepare.press('Enter')
    await expect(dialog.getByTestId('handoff-confirm')).toBeEnabled()
    expect(await prepare.evaluate((button) => getComputedStyle(button).borderTopLeftRadius)).toBe(
      radius
    )
    expect(roots()).toContain(project)
    expect(requests).toHaveLength(0)
    // Repeat with the now-linked reactive workspaceRoots, including a close/reopen cycle.
    await prepare.click()
    await expect(dialog.getByTestId('handoff-confirm')).toBeEnabled()
    await expect(dialog.getByRole('alert')).toHaveCount(0)
    await dialog.getByRole('button', { name: /取消|Cancel/, exact: true }).click()
    await page.getByTestId('history-continue-task').click()
    await dialog
      .getByRole('textbox', { name: /接下来希望 Pi 做什么|What should Pi do next/ })
      .fill('Continue the same task. Do not modify files.')
    await prepare.click()
    await expect(dialog.getByTestId('handoff-confirm')).toBeEnabled()
    await expect(dialog.getByRole('alert')).toHaveCount(0)
    expect(requests).toHaveLength(0)
    await page.screenshot({ path: path.join(testInfo.outputDir, 'handoff-repeat-rounded.png') })
    await dialog.getByTestId('handoff-confirm').click()
    await expect(page.getByTestId('chat-window')).toContainText(
      'Recorded project continuation confirmed.',
      { timeout: 30_000 }
    )
    expect(requests).toHaveLength(1)
    const sessions = await page.evaluate(() => window.piSwitch!.sessions.list(true))
    const continued = sessions.find((s) => s.cwd === project)!
    expect(continued).toBeDefined()
    // The same global focus rule affects circular chat controls and shared icon buttons.
    await page.setViewportSize({ width: 1000, height: 650 })
    const scroller = page.getByTestId('chat-scroller')
    for (const theme of ['macos27-light', 'light', 'dark'] as const) {
      if (theme !== 'macos27-light') {
        await page.locator('a[href="#/settings"]').click()
        await page.getByRole('button', { name: /主题|Theme/, exact: true }).click()
        await page
          .getByRole('option', {
            name: theme === 'light' ? /^(?:浅色|Light)$/ : /^(?:深色|Dark)$/
          })
          .click()
        await page.locator('a[href="#/workspace"]').click()
      }
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await scroller.evaluate((element) => {
        element.scrollTop = element.scrollHeight / 2
      })
      const circle = page.getByTestId('chat-scroll-top')
      await expect(circle).toBeVisible()
      const corners = await circle.evaluate((button) => {
        const style = getComputedStyle(button)
        return [
          style.borderTopLeftRadius,
          style.borderTopRightRadius,
          style.borderBottomLeftRadius,
          style.borderBottomRightRadius
        ]
      })
      expect(parseFloat(corners[0])).toBeGreaterThanOrEqual(14)
      await page.keyboard.press('Tab')
      await circle.focus()
      expect(await circle.evaluate((button) => button.matches(':focus-visible'))).toBe(true)
      expect(
        await circle.evaluate((button) => {
          const style = getComputedStyle(button)
          return [
            style.borderTopLeftRadius,
            style.borderTopRightRadius,
            style.borderBottomLeftRadius,
            style.borderBottomRightRadius
          ]
        })
      ).toEqual(corners)
      const bounds = (await circle.boundingBox())!
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
      await page.mouse.down()
      expect(await circle.evaluate((button) => button.matches(':active'))).toBe(true)
      expect(await circle.evaluate((button) => getComputedStyle(button).borderTopLeftRadius)).toBe(
        corners[0]
      )
      await page.mouse.up()
      await expect(page.getByTestId('chat-scroll-bottom')).toBeVisible()
      const refresh = page.getByTestId('workspace-refresh')
      const iconRadius = await refresh.evaluate(
        (button) => getComputedStyle(button).borderTopLeftRadius
      )
      await page.keyboard.press('Tab')
      await refresh.focus()
      expect(await refresh.evaluate((button) => getComputedStyle(button).borderTopLeftRadius)).toBe(
        iconRadius
      )
    }
    expect(requests).toHaveLength(1)
    const bindings = await page.evaluate(() => window.piSwitch!.workspace.listSessionBindings())
    expect(bindings[continued.id]?.folders.map((folder) => folder.path)).toEqual([project])
    expect(fs.readFileSync(originalPath, 'utf8')).toBe(original)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

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
    await page.getByText('Universal history fixture 中文', { exact: true }).click()
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
  await page.getByText('Cursor SQLite fixture', { exact: true }).click()
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
  await page.getByText('Codex cached history', { exact: true }).click()
  await expect(page.getByTestId('history-messages')).toContainText('Codex cached history')
})

test('keeps history below Git for saved navigation and filters dates with the themed calendar', async ({
  page,
  testUserData
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

test('opens history from the whole card and keeps continuation separate', async ({
  page,
  testUserData,
  workspaceRoot
}, testInfo) => {
  const project = path.join(workspaceRoot, 'pi-harness')
  fs.mkdirSync(project)
  const source = path.join(testUserData, 'history-home', '.codex', 'sessions')
  fs.mkdirSync(source, { recursive: true })
  const titles = [
    '优化会话列表，让标题、项目信息和整张卡片的留白都可以点击查看历史，并保持继续任务独立',
    '修复日期筛选，并适配浅色与深色主题',
    '整理项目导航与会话来源',
    '检查会话同步结果'
  ]
  const control = '<external_codex_apps_open_page>{"page_id":null}</external_codex_apps_open_page>'
  for (let i = 0; i < 30; i++) {
    const title = titles[i] ?? `History archive ${i + 1}`
    fs.writeFileSync(
      path.join(source, `card-${i}.jsonl`),
      [
        { type: 'session_meta', payload: { id: `card-${i}`, cwd: project } },
        {
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: control }]
          }
        },
        {
          type: 'response_item',
          timestamp: new Date(Date.now() - i * 3600_000).toISOString(),
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: title }]
          }
        },
        {
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: `Read-only history for card ${i + 1}` }]
          }
        }
      ]
        .map((record) => JSON.stringify(record))
        .join('\n') + '\n'
    )
  }
  await page.evaluate(() => window.piSwitch!.settings.set({ theme: 'macos27-light' }))
  await page.reload()
  await expect(page.getByTestId('startup-animation')).toBeHidden({ timeout: 12_000 })
  await page.locator('a[href="#/ai-sessions"]').click()
  await page.getByTestId('history-provider-codex').click()
  const list = page.getByTestId('history-session-list')
  const card = (title: string) =>
    list.getByRole('button', { name: new RegExp(`^(查看历史|View history): ${title}$`) })
  const header = page.getByTestId('history-detail-header')
  await card(titles[0]!).getByText(titles[0]!, { exact: true }).click()
  await expect(header.getByRole('heading')).toHaveText(titles[0]!)
  await expect(page.getByTestId('history-messages')).toContainText('Read-only history for card 1')
  await expect(header).not.toContainText('external_codex_apps_open_page')
  await expect(card(titles[0]!)).toHaveAttribute('aria-pressed', 'true')
  await page.screenshot({ path: path.join(testInfo.outputDir, 'history-cards-glass.png') })
  await card(titles[1]!).getByText('pi-harness', { exact: true }).click()
  await expect(header.getByRole('heading')).toHaveText(titles[1]!)
  const third = card(titles[2]!)
  const bounds = (await third.boundingBox())!
  await third.click({ position: { x: bounds.width / 2, y: bounds.height - 5 } })
  await expect(header.getByRole('heading')).toHaveText(titles[2]!)
  await card(titles[3]!).press('Enter')
  await expect(header.getByRole('heading')).toHaveText(titles[3]!)
  await card(titles[2]!).press('Space')
  await expect(header.getByRole('heading')).toHaveText(titles[2]!)
  await expect(page.getByRole('dialog')).toBeHidden()
  await list.evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  await card('History archive 30').click()
  await expect(page.getByTestId('history-messages')).toContainText('Read-only history for card 30')
  await page.getByTestId('history-continue-task').click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: /取消|Cancel/, exact: true }).click()
  await page.evaluate(() => window.piSwitch!.settings.set({ theme: 'dark' }))
  await page.reload()
  await expect(page.getByTestId('startup-animation')).toBeHidden({ timeout: 12_000 })
  await card(titles[0]!).click()
  await expect(header.getByRole('heading')).toHaveText(titles[0]!)
  await page.screenshot({ path: path.join(testInfo.outputDir, 'history-cards-dark.png') })
})

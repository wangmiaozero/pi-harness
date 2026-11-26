import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { _electron as electron } from '@playwright/test'
import { test, expect } from './fixtures'

test('permission menu controls execution and termination remains available during tool approval', async ({
  page,
  electronApp,
  piAgentDir,
  testUserData
}, testInfo) => {
  type Reply = string | { tool: string; args: Record<string, unknown> }
  const replies: Reply[] = []
  const requests: Array<{
    tools?: Array<{ function: { name: string } }>
    messages: Array<{ role: string; content: unknown }>
  }> = []
  let networkCalls = 0
  const server = http.createServer(async (request, response) => {
    if (request.url === '/network-fixture') {
      networkCalls += 1
      response.end('network fixture')
      return
    }
    let body = ''
    for await (const chunk of request) body += chunk
    requests.push(JSON.parse(body))
    const reply = replies.shift() ?? 'Task complete'
    const tool = typeof reply !== 'string'
    const delta = tool
      ? {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: `tool-${Date.now()}`,
              type: 'function',
              function: { name: reply.tool, arguments: JSON.stringify(reply.args) }
            }
          ]
        }
      : { role: 'assistant', content: reply }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    for (const part of [
      { delta, finish_reason: null },
      { delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }
    ]) {
      response.write(
        `data: ${JSON.stringify({ id: 'permissions', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, ...part }] })}\n\n`
      )
    }
    response.end('data: [DONE]\n\n')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  fs.writeFileSync(
    path.join(piAgentDir, 'models.json'),
    JSON.stringify({
      providers: {
        fixture: {
          api: 'openai-completions',
          apiKey: 'local-fixture',
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          models: [
            {
              id: 'fixture',
              name: 'Permissions fixture',
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
  const extensions = path.join(piAgentDir, 'extensions')
  fs.mkdirSync(extensions, { recursive: true })
  fs.writeFileSync(
    path.join(extensions, 'custom-echo.ts'),
    `
    export default function (pi) {
      pi.registerTool({
        name: 'custom_echo', label: 'Custom Echo', description: 'Echo fixture', defaultActive: false,
        parameters: { type: 'object', properties: {} },
        async execute() { return { content: [{ type: 'text', text: 'Custom extension ran' }] } }
      })
    }
  `
  )
  try {
    await electronApp.evaluate(({ dialog }) => {
      const state = globalThis as unknown as { permissionDialogs: number }
      state.permissionDialogs = 0
      dialog.showMessageBox = async (_window, options) => {
        state.permissionDialogs += 1
        return new Promise((resolve) => {
          const decline = () => resolve({ response: 1, checkboxChecked: false })
          if (options.signal?.aborted) decline()
          else options.signal?.addEventListener('abort', decline, { once: true })
        })
      }
    })
    await page.evaluate(async () => {
      await window.piSwitch.settings.set({ theme: 'dark' })
    })
    await page.reload()
    await page.evaluate(async () => {
      await window.piSwitch.models.list()
      await window.piSwitch.models.setActive({ providerKey: 'fixture', modelId: 'fixture' })
    })
    await page.locator('a[href="#/workspace"]').click()
    const composer = page.getByTestId('chat-composer')
    const toolPreset = composer.getByRole('button', { name: '更改工具预设', exact: true })
    await expect(toolPreset).toHaveText('full')
    await toolPreset.click()
    const toolMenu = page.getByRole('listbox', { name: '更改工具预设', exact: true })
    await expect(toolMenu.getByRole('option')).toHaveCount(5)
    await expect(toolMenu.getByRole('option', { name: 'full', exact: true })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await toolMenu.screenshot({ path: testInfo.outputPath('tool-preset-menu.png') })
    await toolMenu.getByRole('option', { name: 'full', exact: true }).click()
    const add = composer.getByTestId('composer-add')
    const goal = page.getByTestId('composer-mode-goal')
    const plan = page.getByTestId('composer-mode-plan')
    const resetMode = composer.getByRole('button', { name: '智能体', exact: true })
    await add.click()
    const addMenu = page.getByRole('menu', { name: '添加', exact: true })
    await expect(addMenu.getByRole('menuitem')).toHaveCount(3)
    await expect(addMenu.getByRole('menuitemcheckbox')).toHaveCount(2)
    await expect(goal).toHaveAttribute('aria-checked', 'false')
    await addMenu.screenshot({ path: testInfo.outputPath('agent-mode-menu.png') })
    await goal.click()
    await expect(resetMode).toHaveText('目标')
    await add.press('ArrowDown')
    await expect(goal).toHaveAttribute('aria-checked', 'true')
    await goal.press('Enter')
    await expect(resetMode).toBeHidden()
    const permission = composer.getByRole('button', { name: '权限模式', exact: true })
    await expect(permission).toHaveText('完全访问')
    await permission.click()
    const menu = page.getByRole('listbox', { name: '权限模式' })
    await expect(menu).toContainText('应如何批准 Pi 操作？')
    await expect(menu.getByRole('option')).toHaveCount(3)
    await expect(menu.getByRole('option', { name: /完全访问权限/ })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await menu.screenshot({ path: testInfo.outputPath('permission-menu.png') })
    await menu.getByRole('option', { name: /帮我批准/ }).click()
    await expect(permission).toHaveText('帮我批准')
    await permission.click()
    await menu.getByRole('option', { name: /完全访问权限/ }).click()

    const externalFile = path.join(testUserData, 'outside-workspace.txt')
    replies.push(
      { tool: 'write', args: { path: externalFile, content: 'Full access fixture' } },
      {
        tool: 'bash',
        args: { command: `curl -s http://127.0.0.1:${address.port}/network-fixture` }
      },
      'Full access complete'
    )
    const editor = composer.getByTestId('composer-editor')
    await editor.fill('Run full access fixture')
    await editor.press('Enter')
    await expect(page.locator('.chat-scroller')).toContainText('Full access complete', {
      timeout: 45_000
    })
    expect(fs.readFileSync(externalFile, 'utf8')).toBe('Full access fixture')
    expect(networkCalls).toBe(1)
    expect(
      await electronApp.evaluate(
        () => (globalThis as unknown as { permissionDialogs: number }).permissionDialogs
      )
    ).toBe(0)
    const terminate = composer.getByRole('button', { name: '终止', exact: true })
    await expect(terminate).toHaveCount(0)

    await permission.click()
    await menu.getByRole('option', { name: /帮我批准/ }).click()
    replies.push(
      {
        tool: 'bash',
        args: { command: `curl -s http://127.0.0.1:${address.port}/network-fixture` }
      },
      'Assisted access complete'
    )
    await editor.fill('Run assisted network fixture')
    await editor.press('Enter')
    await expect(page.locator('.chat-scroller')).toContainText('Assisted access complete')
    expect(networkCalls).toBe(2)
    await permission.click()
    await menu.getByRole('option', { name: /完全访问权限/ }).click()
    const builtins = new Set(['bash', 'powershell', 'read', 'edit', 'write', 'grep', 'find', 'ls'])
    const enabledExtensions = (requests.at(-1)?.tools ?? [])
      .map((tool) => tool.function.name)
      .filter((name) => !builtins.has(name))
    for (const [preset, names] of [
      ['off', []],
      ['read-only', ['read', 'grep', 'find', 'ls']],
      ['default', ['read', 'bash', 'edit', 'write']],
      ['full', ['bash', 'read', 'edit', 'write', 'grep', 'find', 'ls']]
    ] as const) {
      await toolPreset.click()
      await toolMenu.getByRole('option', { name: preset, exact: true }).click()
      const target = path.join(testUserData, `${preset}-tool-check.txt`)
      replies.push(
        { tool: 'write', args: { path: target, content: preset } },
        `${preset} profile complete`
      )
      const before = requests.length
      await editor.fill(`Verify ${preset} tools`)
      await editor.press('Enter')
      await expect(page.locator('.chat-scroller')).toContainText(`${preset} profile complete`)
      expect((requests[before].tools ?? []).map((tool) => tool.function.name).sort()).toEqual(
        [...names, ...(preset === 'default' || preset === 'full' ? enabledExtensions : [])].sort()
      )
      expect(fs.existsSync(target)).toBe(preset === 'default' || preset === 'full')
      await expect(terminate).toHaveCount(0)
    }

    await toolPreset.click()
    await toolMenu.getByRole('option', { name: '自定义', exact: true }).click()
    const sessionTools = page.getByRole('dialog', { name: '当前会话工具' })
    await expect(sessionTools).toBeVisible()
    await expect(toolMenu).toHaveCount(0)
    await expect(sessionTools.getByRole('searchbox')).toBeFocused()
    const sessionId = await page.evaluate(async () => {
      const sessions = await window.piSwitch.sessions.list(true)
      return sessions.find((session) => session.messageCount > 0)!.id
    })
    const runtimeTools = () => page.evaluate((id) => window.piSwitch.harness.tools(id), sessionId)
    const manageable = (await runtimeTools())
      .filter((tool) => tool.available !== false)
      .map((tool) => tool.name)
      .sort()
    const selectedTools = async () =>
      (await runtimeTools())
        .filter((tool) => tool.active)
        .map((tool) => tool.name)
        .sort()
    await sessionTools.getByRole('button', { name: '全选', exact: true }).click()
    await expect(sessionTools.getByRole('status').first()).toHaveText(
      `已启用 ${manageable.length} 项`
    )
    expect(await selectedTools()).toEqual(manageable)

    const readDescription = sessionTools.getByRole('button', { name: 'read 的说明', exact: true })
    await expect(readDescription).toHaveAttribute('aria-expanded', 'false')
    await readDescription.click()
    await expect(readDescription).toHaveAttribute('aria-expanded', 'true')
    await expect(sessionTools.getByRole('checkbox', { name: 'read', exact: true })).toBeChecked()
    await readDescription.click()
    await expect(readDescription).toHaveAttribute('aria-expanded', 'false')

    await page.evaluate(
      (id) => window.piSwitch.harness.setTools(id, ['read'], { custom: true }),
      sessionId
    )
    await sessionTools.getByRole('button', { name: '从 Pi 刷新' }).click()
    await expect(sessionTools.getByRole('button', { name: '已刷新', exact: true })).toBeVisible()
    await expect(sessionTools.getByRole('status').first()).toHaveText('已启用 1 项')
    await expect(sessionTools.getByRole('checkbox', { name: 'read', exact: true })).toBeChecked()
    await sessionTools.screenshot({ path: testInfo.outputPath('session-tools-dialog.png') })

    await sessionTools.getByRole('button', { name: '清空选择' }).click()
    await expect(sessionTools.getByRole('status').first()).toHaveText('已启用 0 项')
    expect(await selectedTools()).toEqual([])
    const toolSearch = sessionTools.getByRole('searchbox')
    await toolSearch.fill('tool-that-does-not-exist')
    await expect(sessionTools.getByRole('checkbox')).toHaveCount(0)
    await toolSearch.fill('write')
    const writeTool = sessionTools.getByRole('checkbox', { name: 'write', exact: true })
    await expect(writeTool).not.toBeChecked()
    await writeTool.click()
    await expect(writeTool).toBeChecked()
    await writeTool.press('Space')
    await expect(writeTool).not.toBeChecked()
    await expect(writeTool).toBeFocused()
    expect(await selectedTools()).toEqual([])
    await writeTool.click()
    await expect(writeTool).toBeChecked()
    await toolSearch.fill('custom_echo')
    const extensionTool = sessionTools.getByRole('checkbox', { name: 'custom_echo', exact: true })
    await extensionTool.click()
    await expect(extensionTool).toBeChecked()
    await sessionTools.getByRole('button', { name: '关闭', exact: true }).click()
    await expect(sessionTools).toBeHidden()
    await expect(toolPreset).toBeFocused()
    await toolPreset.click()
    await toolMenu.getByRole('option', { name: 'full', exact: true }).click()
    await expect(toolPreset).toHaveText('full')
    await toolPreset.click()
    await toolMenu.getByRole('option', { name: '自定义', exact: true }).click()
    await expect(sessionTools.getByRole('checkbox', { name: 'write', exact: true })).toBeChecked()
    await expect(sessionTools.getByRole('status').first()).toHaveText('已启用 2 项')
    await sessionTools.getByRole('searchbox').press('Escape')
    await expect(sessionTools).toBeHidden()

    const customBefore = requests.length
    replies.push(
      { tool: 'custom_echo', args: {} },
      { tool: 'write', args: { path: externalFile, content: 'Custom write fixture' } },
      'Custom profile complete'
    )
    await editor.fill('Verify the custom selection')
    await editor.press('Enter')
    await expect(page.locator('.chat-scroller')).toContainText('Custom profile complete')
    expect((requests[customBefore].tools ?? []).map((tool) => tool.function.name).sort()).toEqual([
      'custom_echo',
      'write'
    ])
    expect(JSON.stringify(requests[customBefore + 1].messages)).toContain('Custom extension ran')
    expect(fs.readFileSync(externalFile, 'utf8')).toBe('Custom write fixture')

    await page.reload()
    await expect(toolPreset).toHaveText('自定义')
    await toolPreset.click()
    await toolMenu.getByRole('option', { name: '自定义', exact: true }).click()
    await expect(sessionTools.getByRole('status').first()).toHaveText('已启用 2 项')
    await expect(extensionTool).toBeChecked()
    await sessionTools.getByRole('searchbox').press('Escape')
    await expect(sessionTools).toBeHidden()

    await toolPreset.click()
    await toolMenu.getByRole('option', { name: 'full', exact: true }).click()
    await add.click()
    await plan.click()
    const planTarget = path.join(testUserData, 'planning-must-not-write.txt')
    replies.push(
      { tool: 'write', args: { path: planTarget, content: 'blocked' } },
      'Planning profile complete'
    )
    const beforePlan = requests.length
    await editor.fill('Plan a change without writing it')
    await editor.press('Enter')
    await expect(page.locator('.chat-scroller')).toContainText('Planning profile complete')
    expect((requests[beforePlan].tools ?? []).map((tool) => tool.function.name).sort()).toEqual(
      ['read', 'grep', 'find', 'ls'].sort()
    )
    expect(
      requests[beforePlan].messages.some(
        (message) =>
          message.role === 'user' && JSON.stringify(message.content).includes('[Mode: plan]')
      )
    ).toBe(true)
    expect(fs.existsSync(planTarget)).toBe(false)

    await add.click()
    await goal.click()
    replies.push('Goal directive complete')
    const beforeGoal = requests.length
    await editor.fill('Complete the goal in this request')
    await editor.press('Enter')
    await expect(page.locator('.chat-scroller')).toContainText('Goal directive complete')
    expect(
      requests[beforeGoal].messages.some(
        (message) =>
          message.role === 'user' && JSON.stringify(message.content).includes('[Mode: goal]')
      )
    ).toBe(true)
    await resetMode.click()
    await toolPreset.click()
    await toolMenu.getByRole('option', { name: 'full', exact: true }).click()
    expect(
      await electronApp.evaluate(
        () => (globalThis as unknown as { permissionDialogs: number }).permissionDialogs
      )
    ).toBe(0)
    await expect(terminate).toHaveCount(0)

    await permission.click()
    await menu.getByRole('option', { name: /请求批准/ }).click()
    replies.push({
      tool: 'bash',
      args: { command: `curl -s http://127.0.0.1:${address.port}/network-fixture` }
    })
    await editor.fill('Request network approval')
    await editor.press('Enter')
    await expect
      .poll(() =>
        electronApp.evaluate(
          () => (globalThis as unknown as { permissionDialogs: number }).permissionDialogs
        )
      )
      .toBe(1)
    await expect(terminate).toBeVisible()
    const busyToolError = await page.evaluate(async () => {
      const [sessionId] = await window.piSwitch.agent.running()
      try {
        await window.piSwitch.harness.setTools(sessionId, ['read'], { custom: true })
        return null
      } catch (error) {
        return (error as { message: string }).message
      }
    })
    expect(busyToolError).toContain('Wait for the current run to finish')
    await terminate.click()
    await expect(terminate).toHaveCount(0)
    expect(networkCalls).toBe(2)

    await toolPreset.click()
    await toolMenu.getByRole('option', { name: '自定义', exact: true }).click()
    await expect(sessionTools.getByRole('status').first()).toHaveText('已启用 2 项')
    const { spawnfile, spawnargs } = electronApp.process()
    await electronApp.close()
    const restarted = await electron.launch({
      executablePath: spawnfile,
      args: spawnargs.slice(1),
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: undefined,
        PI_HARNESS_AGENT_MODE: process.env.PI_HARNESS_E2E_AGENT_MODE ?? 'sdk',
        PI_HARNESS_USER_DATA: testUserData,
        PI_HARNESS_PI_CLI_PATH: path.join(testUserData, 'missing-pi-cli'),
        PI_HARNESS_PI_CONFIG_DIR: piAgentDir,
        PI_CODING_AGENT_DIR: piAgentDir,
        PI_HARNESS_SESSION_HOME: path.join(testUserData, 'history-home'),
        PI_HARNESS_DISABLE_ACCOUNT_DISCOVERY: '1',
        PI_HARNESS_CAPABILITY_FIXTURES_DIR: path.resolve('fixtures/capabilities'),
        PI_HARNESS_BUILTIN_SKILLS_DIR: path.resolve('resources/builtin-skills')
      }
    })
    try {
      const reopened = await restarted.firstWindow()
      await reopened.locator('a[href="#/workspace"]').click()
      await reopened.getByTestId(`session-row-${sessionId}`).click()
      const reopenedTools = reopened.getByRole('button', { name: '更改工具预设', exact: true })
      await expect(reopenedTools).toHaveText('自定义')
      await reopenedTools.click()
      await reopened.getByRole('option', { name: '自定义', exact: true }).click()
      const reopenedList = reopened.getByRole('dialog', { name: '当前会话工具' })
      await expect(reopenedList.getByRole('status').first()).toHaveText('已启用 2 项')
      await expect(reopenedList.getByRole('checkbox', { name: 'write', exact: true })).toBeChecked()
      await expect(
        reopenedList.getByRole('checkbox', { name: 'custom_echo', exact: true })
      ).toBeChecked()
    } finally {
      await restarted.close()
    }
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

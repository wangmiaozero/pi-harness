import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
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
    await expect(toolMenu.getByRole('option')).toHaveCount(4)
    await expect(toolMenu.getByRole('option', { name: 'full', exact: true })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await toolMenu.screenshot({ path: testInfo.outputPath('tool-preset-menu.png') })
    await toolMenu.getByRole('option', { name: 'full', exact: true }).click()
    const agentMode = composer.getByRole('button', { name: '模式', exact: true })
    await agentMode.click()
    const modes = page.getByRole('listbox', { name: '模式', exact: true })
    await expect(modes).toContainText('选择 Pi 的工作方式')
    await expect(modes.getByRole('option')).toHaveCount(3)
    await expect(modes.getByRole('option', { name: '智能体', exact: true })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await modes.screenshot({ path: testInfo.outputPath('agent-mode-menu.png') })
    await modes.getByRole('option', { name: '目标', exact: true }).click()
    await expect(agentMode).toHaveText('目标')
    await agentMode.press('ArrowDown')
    await modes.getByRole('option', { name: '目标', exact: true }).press('Home')
    await modes.getByRole('option', { name: '智能体', exact: true }).press('Enter')
    await expect(agentMode).toHaveText('智能体')
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

    await agentMode.click()
    await modes.getByRole('option', { name: '规划', exact: true }).click()
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

    await agentMode.click()
    await modes.getByRole('option', { name: '目标', exact: true }).click()
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
    await agentMode.click()
    await modes.getByRole('option', { name: '智能体', exact: true }).click()
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
    await terminate.click()
    await expect(terminate).toHaveCount(0)
    expect(networkCalls).toBe(2)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

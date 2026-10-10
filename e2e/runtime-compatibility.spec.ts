import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { test, expect } from './fixtures'

test('keeps thinking and tools working after a successful connection probe, with stable button corners', async ({
  page,
  electronApp,
  piAgentDir,
  workspaceRoot
}, testInfo) => {
  const requests: Record<string, unknown>[] = []
  let releaseProbe: (() => void) | undefined
  let streamCount = 0
  const server = http.createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    const payload = JSON.parse(body) as Record<string, unknown>
    requests.push(payload)
    if (!payload.stream) {
      await new Promise<void>((resolve) => {
        releaseProbe = resolve
      })
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(
        JSON.stringify({
          id: 'probe',
          object: 'chat.completion',
          created: 1,
          model: 'gpt-4o',
          choices: [
            { index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }
          ]
        })
      )
      return
    }
    // Match the provider's actual restriction; a no-tools probe alone cannot expose it.
    if (payload.tool_choice === 'required' || typeof payload.tool_choice === 'object') {
      response.writeHead(400, { 'Content-Type': 'application/json' })
      response.end(
        JSON.stringify({
          error: {
            message: 'Thinking mode does not support this tool_choice',
            type: 'invalid_request_error'
          }
        })
      )
      return
    }
    streamCount += 1
    const tool = streamCount === 1
    const delta = tool
      ? {
          role: 'assistant',
          reasoning_content: 'I will write the requested file using a tool.',
          tool_calls: [
            {
              index: 0,
              id: 'call-write',
              type: 'function',
              function: {
                name: 'write',
                arguments: JSON.stringify({
                  path: 'compatibility.txt',
                  content: 'compatible tools preserved\n'
                })
              }
            }
          ]
        }
      : { role: 'assistant', content: 'Thinking and file tools completed successfully.' }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    for (const part of [
      { delta, finish_reason: null },
      { delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }
    ]) {
      response.write(
        `data: ${JSON.stringify({ id: 'thinking-chat', object: 'chat.completion.chunk', created: 1, model: 'gpt-4o', choices: [{ index: 0, ...part }] })}\n\n`
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
        'openai-compatible': {
          api: 'openai-completions',
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          apiKey: '$PI_HARNESS_COMPAT_TEST_KEY',
          models: [
            {
              id: 'gpt-4o',
              name: 'Local thinking fixture',
              reasoning: true,
              input: ['text'],
              contextWindow: 128000,
              maxTokens: 4096,
              compat: {
                thinkingFormat: 'deepseek',
                requiresReasoningContentOnAssistantMessages: true
              }
            }
          ]
        }
      }
    })
  )
  try {
    await electronApp.evaluate(() => {
      process.env.PI_HARNESS_COMPAT_TEST_KEY = 'local-test-placeholder'
    })
    await page.evaluate(() => window.piSwitch.settings.set({ theme: 'macos27-light' }))
    await page.reload()
    await page.locator('a[href="#/models"]').click()
    await expect(page.getByText('Local thinking fixture', { exact: true }).last()).toBeVisible()
    await page
      .getByTestId('model-action-cell')
      .getByRole('button', { name: /测试|Test/, exact: true })
      .click()
    const dialog = page.getByRole('dialog')
    // Loading intentionally hides the label, so retain the same primary button locator.
    const run = dialog.locator('button[data-variant="primary"]')
    await expect(run).toHaveText(/开始测试|Start test/)
    const radius = await run.evaluate((button) => getComputedStyle(button).borderTopLeftRadius)
    expect(parseFloat(radius)).toBeGreaterThan(0)
    await page.keyboard.press('Tab')
    await run.focus()
    expect(await run.evaluate((button) => button.matches(':focus-visible'))).toBe(true)
    expect(await run.evaluate((button) => getComputedStyle(button).borderTopLeftRadius)).toBe(
      radius
    )
    await run.press('Enter')
    await expect.poll(() => Boolean(releaseProbe)).toBe(true)
    await expect(run).toBeDisabled()
    expect(await run.evaluate((button) => getComputedStyle(button).borderTopLeftRadius)).toBe(
      radius
    )
    releaseProbe!()
    await expect(dialog.getByText('HTTP 200', { exact: true })).toBeVisible()
    await expect(run).toBeEnabled()
    expect(await run.evaluate((button) => getComputedStyle(button).borderTopLeftRadius)).toBe(
      radius
    )
    await page.screenshot({ path: path.join(testInfo.outputDir, 'connection-rounded.png') })
    await dialog
      .getByRole('button', { name: /关闭|Close/, exact: true })
      .last()
      .click()
    const started = await page.evaluate(
      (cwd) =>
        window.piSwitch.agent.start({
          cwd,
          provider: 'openai-compatible',
          modelId: 'gpt-4o',
          thinkingLevel: 'high'
        }),
      fs.realpathSync(workspaceRoot)
    )
    await page.evaluate(
      (sessionId) =>
        window.piSwitch.agent.prompt({
          sessionId,
          message: 'Write compatibility.txt with content: compatible tools preserved.'
        }),
      started.sessionId
    )
    await expect.poll(() => fs.existsSync(path.join(workspaceRoot, 'compatibility.txt'))).toBe(true)
    expect(fs.readFileSync(path.join(workspaceRoot, 'compatibility.txt'), 'utf8')).toBe(
      'compatible tools preserved\n'
    )
    await expect.poll(() => streamCount).toBe(2)
    await expect
      .poll(() =>
        page.evaluate(
          (id) => window.piSwitch.agent.running().then((ids) => ids.includes(id)),
          started.sessionId
        )
      )
      .toBe(false)
    expect(requests).toHaveLength(3)
    for (const outgoing of requests.slice(1)) {
      expect(outgoing.thinking).toEqual({ type: 'enabled' })
      expect(outgoing.tool_choice).toBeUndefined()
      expect(outgoing.tools).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'function' })])
      )
    }
    expect(JSON.stringify(requests[2].messages)).toContain('compatible tools preserved')
    const persisted = await page.evaluate(
      (id) => window.piSwitch.sessions.get(id),
      started.sessionId
    )
    expect(JSON.stringify(persisted.context.messages)).toContain(
      'Thinking and file tools completed successfully.'
    )
  } finally {
    releaseProbe?.()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

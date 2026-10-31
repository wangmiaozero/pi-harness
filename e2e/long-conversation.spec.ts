import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { test, expect } from './fixtures'

test('automatically recovers a truncated conversation through native compaction without losing its history', async ({
  page,
  piAgentDir
}, testInfo) => {
  const requests: Array<{ messages: Array<{ role: string; content: unknown }> }> = []
  let chatRequests = 0
  let summaries = 0
  let releaseSummary: (() => void) | undefined
  let summaryHeld = false
  let failSummary = false
  let failedSummaries = 0
  const provider = http.createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    const payload = JSON.parse(body)
    requests.push(payload)
    const summary = JSON.stringify(payload.messages).includes('context summarization assistant')
    if (summary) summaries += 1
    else chatRequests += 1
    if (summary && failSummary) {
      failedSummaries += 1
      response.writeHead(400, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'Fixture summarization unavailable' } }))
      return
    }
    if (summary && chatRequests === 4 && !summaryHeld) {
      summaryHeld = true
      await new Promise<void>((resolve) => {
        releaseSummary = resolve
      })
    }
    const truncated = !summary && [2, 4, 6].includes(chatRequests)
    const text = summary
      ? '## Goal\nContinue the long conversation.\n## Progress\nPrior work is complete.'
      : chatRequests === 1
        ? 'Prior work recorded.'
        : 'Recovered conversation reply.'
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    for (const chunk of [
      {
        choices: [
          {
            index: 0,
            delta: truncated
              ? { role: 'assistant', reasoning_content: 'Let' }
              : { role: 'assistant', content: text },
            finish_reason: null
          }
        ]
      },
      {
        choices: [{ index: 0, delta: {}, finish_reason: truncated ? 'length' : 'stop' }],
        usage: {
          prompt_tokens: truncated ? 131_261 : 1000,
          completion_tokens: truncated ? 1 : 40,
          total_tokens: truncated ? 131_262 : 1040
        }
      }
    ]) {
      response.write(
        `data: ${JSON.stringify({ id: 'long-chat', object: 'chat.completion.chunk', created: 1, model: 'fixture', ...chunk })}\n\n`
      )
    }
    response.end('data: [DONE]\n\n')
  })
  await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve))
  const address = provider.address() as { port: number }
  fs.writeFileSync(
    path.join(piAgentDir, 'settings.json'),
    JSON.stringify({
      defaultProvider: 'fixture',
      defaultModel: 'fixture',
      compaction: { enabled: false, keepRecentTokens: 1024 },
      retry: { enabled: false }
    })
  )
  fs.writeFileSync(
    path.join(piAgentDir, 'models.json'),
    JSON.stringify({
      providers: {
        fixture: {
          api: 'openai-completions',
          apiKey: 'local-fixture-placeholder',
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          models: [
            {
              id: 'fixture',
              name: 'Long conversation fixture',
              input: ['text'],
              reasoning: true,
              contextWindow: 128000,
              maxTokens: 4096,
              compat: { thinkingFormat: 'deepseek' }
            }
          ]
        }
      }
    })
  )
  try {
    await page.evaluate(async () => {
      await window.piSwitch.models.list()
      await window.piSwitch.models.setActive({ providerKey: 'fixture', modelId: 'fixture' })
    })
    await page.locator('a[href="#/workspace"]').click()
    const composer = page.getByTestId('chat-composer')
    const editor = composer.getByTestId('composer-editor')
    const priorWork = `Retain prior work marker.\n${'Earlier conversation details. '.repeat(1200)}`
    await editor.fill(priorWork)
    await editor.press('Enter')
    await expect(page.getByTestId('chat-scroller')).toContainText('Prior work recorded.')
    await expect(page.getByTestId('composer-abort')).toBeHidden()
    const sessions = await page.evaluate(() => window.piSwitch.sessions.list())
    const sessionId = sessions.find((session) => session.messageCount >= 2)!.id
    const before = await page.evaluate((id) => window.piSwitch.sessions.get(id), sessionId)
    await editor.fill(`Continue the long task\n${'Recent task details. '.repeat(500)}`)
    await editor.press('Enter')
    const warning = page.getByRole('alert').filter({ hasText: '回复因模型' })
    await expect
      .poll(() =>
        page.evaluate(
          (id) => window.piSwitch.agent.state(id).then((state) => state?.autoCompactionEnabled),
          sessionId
        )
      )
      .toBe(true)
    await expect(page.getByTestId('chat-scroller')).toContainText('Recovered conversation reply.')
    await expect(page.getByTestId('composer-abort')).toBeHidden()
    await expect(warning).toBeHidden()
    expect(summaries).toBeGreaterThan(0)
    expect(chatRequests).toBe(3)
    await composer.getByTestId('composer-more').click()
    await expect(page.getByTestId('composer-compact')).toHaveCount(0)
    await expect(page.getByTestId('composer-sound-toggle')).toBeVisible()
    await page.keyboard.press('Escape')
    await page.screenshot({ path: path.join(testInfo.outputDir, 'automatic-compaction.png') })
    await page.reload()
    await expect(page.getByTestId('chat-scroller')).toContainText('Recovered conversation reply.')
    await expect(warning).toBeHidden()
    const after = await page.evaluate((id) => window.piSwitch.sessions.get(id), sessionId)
    expect(after.filePath).toBe(before.filePath)
    const raw = fs.readFileSync(after.filePath, 'utf8')
    const entries = raw
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(entries.some((entry) => entry.type === 'compaction')).toBe(true)
    expect(raw).toContain('Retain prior work marker.')
    expect(raw).toContain('Continue the long task')
    expect(JSON.stringify(requests.at(-1)?.messages)).toContain('Prior work is complete.')
    expect(
      requests.at(-1)?.messages.filter((message) => message.role === 'user').length
    ).toBeLessThan(3)

    // A later length stop is recovered within the same Native run. Keep the summary
    // pending to verify that the temporary failed attempt never becomes a UI error.
    await editor.fill(`Another long task\n${'Current task details. '.repeat(500)}`)
    await editor.press('Enter')
    await expect.poll(() => Boolean(releaseSummary)).toBe(true)
    await expect(warning).toBeHidden()
    releaseSummary!()
    await expect.poll(() => chatRequests).toBe(5)
    await expect(page.getByTestId('composer-abort')).toBeHidden()
    await expect(warning).toBeHidden()

    failSummary = true
    await editor.fill(`Task with unavailable summarization\n${'More task details. '.repeat(500)}`)
    await editor.press('Enter')
    await expect.poll(() => failedSummaries).toBeGreaterThan(0)
    await expect(page.getByRole('alert')).toContainText('Fixture summarization unavailable')
    await expect(page.getByTestId('composer-abort')).toBeHidden()
    expect(chatRequests).toBe(6)
  } finally {
    releaseSummary?.()
    provider.closeAllConnections()
    await new Promise<void>((resolve) => provider.close(() => resolve()))
  }
})

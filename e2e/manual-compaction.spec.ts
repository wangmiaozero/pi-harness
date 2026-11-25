import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { test, expect } from './fixtures'

test('compacts from the composer with smart compaction disabled', async ({ page, piAgentDir }) => {
  const requests: string[] = []
  let chatRequests = 0
  let releaseSummary: (() => void) | undefined
  const provider = http.createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    requests.push(body)
    const summary = body.includes('context summarization assistant')
    if (summary) {
      await new Promise<void>((resolve) => {
        releaseSummary = resolve
      })
    }
    const content = summary ? 'Manual context checkpoint.' : `Reply ${++chatRequests}.`
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    for (const part of [
      { delta: { role: 'assistant', content }, finish_reason: null },
      { delta: {}, finish_reason: 'stop' }
    ]) {
      const event = {
        id: 'manual-compaction',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'fixture',
        choices: [{ index: 0, ...part }],
        usage: { prompt_tokens: 1000, completion_tokens: 8, total_tokens: 1008 }
      }
      response.write(`data: ${JSON.stringify(event)}\n\n`)
    }
    response.end('data: [DONE]\n\n')
  })
  await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve))
  try {
    const address = provider.address() as { port: number }
    fs.writeFileSync(
      path.join(piAgentDir, 'settings.json'),
      JSON.stringify({
        defaultProvider: 'fixture',
        defaultModel: 'fixture',
        compaction: { enabled: true, keepRecentTokens: 256 }
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
            models: [{ id: 'fixture', name: 'Manual compaction fixture', reasoning: false }]
          }
        }
      })
    )
    await page.evaluate(async () => {
      await window.piSwitch.settings.set({
        smartCompaction: { enabled: false, ratio: 0.8, maxTokens: 256000 }
      })
      await window.piSwitch.models.list()
      await window.piSwitch.models.setActive({ providerKey: 'fixture', modelId: 'fixture' })
    })
    await page.locator('a[href="#/workspace"]').click()
    const composer = page.getByTestId('chat-composer')
    const button = composer.getByRole('button', { name: '主动压缩上下文', exact: true })
    const editor = composer.getByTestId('composer-editor')
    const chat = page.getByTestId('chat-scroller')
    await expect(button).toBeDisabled()
    for (const [index, context] of ['Earlier work. ', 'Recent work. '].entries()) {
      await editor.fill(context.repeat(500))
      await editor.press('Enter')
      await expect(chat).toContainText(`Reply ${index + 1}.`)
      await expect(button).toBeEnabled()
    }
    expect(requests).toHaveLength(2)

    await editor.fill('Continue from the checkpoint.')
    await button.click()
    await expect.poll(() => Boolean(releaseSummary)).toBe(true)
    await expect(button).toBeDisabled()
    await expect(button).toHaveAttribute('aria-busy', 'true')
    await expect(page.getByTestId('compacting-status')).toBeVisible()
    releaseSummary!()
    await expect(button).toBeEnabled()
    await expect(editor).toHaveText('Continue from the checkpoint.')
    expect(requests).toHaveLength(3)

    const sessions = await page.evaluate(() => window.piSwitch.sessions.list())
    const sessionId = sessions.find((session) => session.messageCount >= 2)!.id
    const saved = await page.evaluate((id) => window.piSwitch.sessions.get(id), sessionId)
    const history = fs.readFileSync(saved.filePath, 'utf8')
    expect(history).toContain('Earlier work.')
    expect(history).toContain('Manual context checkpoint.')
    const state = await page.evaluate((id) => window.piSwitch.agent.state(id), sessionId)
    expect(state).toMatchObject({
      autoCompactionEnabled: true,
      compaction: { smartEnabled: false, trigger: 'manual', phase: 'succeeded' }
    })

    await editor.press('Enter')
    await expect(chat).toContainText('Reply 3.')
    await expect(button).toBeEnabled()
    expect(requests.at(-1)).toContain('Manual context checkpoint.')
    expect(requests.at(-1)).not.toContain('Earlier work. Earlier work.')
  } finally {
    releaseSummary?.()
    provider.closeAllConnections()
    await new Promise<void>((resolve) => provider.close(() => resolve()))
  }
})

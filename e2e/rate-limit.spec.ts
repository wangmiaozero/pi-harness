import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { test, expect } from './fixtures'

test('recovers from a temporary token rate limit and explains a persistent throttle', async ({
  page,
  piAgentDir
}) => {
  const requests: string[] = []
  const error =
    'Rate limit reached for the fixture on tokens per min (TPM). Please try again in 5.201s. ' +
    'You can increase your rate limit by adding a payment method to your account at https://platform.openai.com/account/billing.'
  const provider = http.createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    requests.push(body)
    if (requests.length === 2 || requests.length >= 4) {
      response.writeHead(429, { 'Content-Type': 'application/json' })
      response.end(
        JSON.stringify({ error: { message: error, type: 'tokens', code: 'rate_limit_exceeded' } })
      )
      return
    }
    const content = requests.length === 1 ? 'Earlier reply.' : 'Recovered after throttling.'
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    for (const part of [
      { delta: { role: 'assistant', content }, finish_reason: null },
      { delta: {}, finish_reason: 'stop' }
    ]) {
      const event = {
        id: 'rate-limit-test',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'fixture',
        choices: [{ index: 0, ...part }]
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
        retry: { enabled: true, maxRetries: 1, baseDelayMs: 1, provider: { maxRetries: 0 } }
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
            models: [{ id: 'fixture', name: 'Rate limit fixture', reasoning: false }]
          }
        }
      })
    )
    await page.evaluate(async () => {
      await window.piSwitch.models.list()
      await window.piSwitch.models.setActive({ providerKey: 'fixture', modelId: 'fixture' })
    })
    await page.locator('a[href="#/workspace"]').click()
    const editor = page.getByTestId('chat-composer').getByTestId('composer-editor')
    const scroller = page.getByTestId('chat-scroller')
    const abort = page.getByTestId('composer-abort')
    const notice = page.getByRole('alert').filter({ hasText: '触发限流' })

    await editor.fill('Remember this earlier instruction.')
    await editor.press('Enter')
    await expect(scroller).toContainText('Earlier reply.')
    await expect(abort).toBeHidden()

    await editor.fill('Continue the same conversation.')
    await editor.press('Enter')
    await expect(scroller).toContainText('Recovered after throttling.')
    await expect(abort).toBeHidden()
    await expect(notice).toBeHidden()
    expect(requests).toHaveLength(3)
    expect(requests[2]).toContain('Earlier reply.')
    expect(requests[2]).toContain('Continue the same conversation.')

    await editor.fill('Try once more.')
    await editor.press('Enter')
    await expect(notice).toBeVisible()
    await expect(abort).toBeHidden()
    expect(requests).toHaveLength(5)
    const errorMessage = scroller.getByTestId('assistant-error').last()
    await expect(errorMessage).toContainText('tokens per minute')
    await expect(errorMessage).toContainText('Retry in about 6s.')
    await expect(scroller).not.toContainText(
      /quota is exhausted|platform\.openai\.com\/account\/billing/i
    )

    await page.reload()
    await expect(scroller).toContainText('Earlier reply.')
    await expect(scroller).toContainText('Recovered after throttling.')
    await expect(errorMessage).toContainText('Retry in about 6s.')
  } finally {
    provider.closeAllConnections()
    await new Promise<void>((resolve) => provider.close(() => resolve()))
  }
})

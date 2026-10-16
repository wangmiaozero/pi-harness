import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { test, expect } from './fixtures'

for (const withImage of [false, true]) {
  test(`shows the first submitted message once through native streaming and reload (image: ${withImage})`, async ({
    page,
    electronApp,
    piAgentDir,
    testUserData
  }) => {
    const requests: Array<{ messages: Array<{ role: string; content: unknown }> }> = []
    let finishResponse: (() => void) | undefined
    const provider = http.createServer(async (request, response) => {
      let body = ''
      for await (const chunk of request) body += chunk
      requests.push(JSON.parse(body))
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const writeChunk = (delta: Record<string, unknown>, finishReason: string | null) => {
        response.write(
          `data: ${JSON.stringify({
            id: `first-message-${requests.length}`,
            object: 'chat.completion.chunk',
            created: 1,
            model: 'fixture',
            choices: [{ index: 0, delta, finish_reason: finishReason }]
          })}\n\n`
        )
      }
      finishResponse = () => {
        writeChunk({}, 'stop')
        response.end('data: [DONE]\n\n')
      }
      writeChunk({ role: 'assistant', content: 'Local reply' }, null)
    })
    await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve))
    const address = provider.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture provider')
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
                name: 'First message fixture',
                reasoning: false,
                input: ['text', 'image'],
                contextWindow: 128000,
                maxTokens: 4096
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
      const users = page.locator('.chat-scroller [data-message-role="user"]')
      const imageData =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
      if (withImage) {
        await composer.locator('input[type="file"]').setInputFiles({
          name: 'pixel.png',
          mimeType: 'image/png',
          buffer: Buffer.from(imageData, 'base64')
        })
        await expect(composer.locator('img')).toHaveCount(1)
      }
      await editor.fill('Check the first message')
      await editor.press('Enter')
      await expect(users).toHaveCount(1)
      if (withImage) await expect(users.locator('img')).toHaveCount(1)

      // Hold the model response open: a final persisted reload would otherwise
      // hide the optimistic/native duplication seen during the first turn.
      await expect.poll(() => requests.length, { timeout: 45_000 }).toBe(1)
      await expect(page.locator('.chat-scroller')).toContainText('Local reply')
      await expect(users).toHaveCount(1)
      const outgoingUsers = requests[0].messages.filter((message) => message.role === 'user')
      expect(outgoingUsers).toHaveLength(1)
      if (withImage) expect(JSON.stringify(outgoingUsers)).toContain('data:image/png;base64,')
      finishResponse!()
      await expect(composer.getByRole('button', { name: /中止|Abort/, exact: true })).toHaveCount(0)
      await expect(page.locator('[data-testid^="session-row-"]')).toHaveCount(1)
      const session = await page.evaluate(() =>
        window.piSwitch.sessions.list(true).then(([item]) => item)
      )
      const detail = await page.evaluate((id) => window.piSwitch.sessions.get(id), session.id)
      expect(detail.context.messages.filter((message) => message.role === 'user')).toHaveLength(1)
      const entries = fs
        .readFileSync(detail.filePath, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
      const nativeUsers = entries.filter(
        (entry) => entry.type === 'message' && entry.message.role === 'user'
      )
      expect(nativeUsers).toHaveLength(1)
      if (withImage) {
        expect(nativeUsers[0].message.content).toContainEqual({
          type: 'image',
          data: imageData,
          mimeType: 'image/png'
        })
      }

      await page.reload()
      await expect(users).toHaveCount(1)
      if (withImage)
        await expect(users.locator('img')).toHaveAttribute('src', /^data:image\/png;base64,/)

      await editor.fill('Check the first message')
      await editor.press('Enter')
      await expect.poll(() => requests.length).toBe(2)
      await expect(users).toHaveCount(2)
      finishResponse!()
      await expect(composer.getByRole('button', { name: /中止|Abort/, exact: true })).toHaveCount(0)
      await expect(users).toHaveCount(2)

      await page
        .getByTestId('chat-status-hud')
        .getByRole('button', { name: /完整历史|Full history/ })
        .click()
      const dialog = page.getByRole('dialog', { name: /完整历史|Full history/ })
      await expect(dialog.locator('[data-message-role="user"]')).toHaveCount(2)
      if (withImage)
        await expect(dialog.locator('[data-message-role="user"] img')).toHaveAttribute(
          'src',
          /^data:image\/png;base64,/
        )
      await dialog.getByRole('button', { name: /关闭|Close/ }).click()

      if (withImage) {
        for (const format of ['markdown', 'html'] as const) {
          const output = path.join(testUserData, `first-message.${format}`)
          await electronApp.evaluate(({ dialog }, filePath) => {
            dialog.showSaveDialog = async () => ({ canceled: false, filePath })
          }, output)
          await page.evaluate(({ id, format }) => window.piSwitch.sessions.export(id, format), {
            id: session.id,
            format
          })
          expect(fs.readFileSync(output, 'utf8')).toContain('[Image: image/png]')
        }
      }
    } finally {
      provider.closeAllConnections()
      await new Promise<void>((resolve) => provider.close(() => resolve()))
    }
  })
}

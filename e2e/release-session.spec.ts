import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { _electron as electron, type Page } from '@playwright/test'
import { test, expect, startFixtureSession } from './fixtures'

test('restores a real Pi session after installed application exit and restart', async ({
  page,
  electronApp,
  piAgentDir,
  workspaceRoot
}) => {
  let requests = 0
  const provider = http.createServer(async (request, response) => {
    for await (const _chunk of request) {
      /* Drain the local fixture request. */
    }
    requests++
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    for (const [delta, finish_reason] of [
      [{ role: 'assistant', content: `Persistent reply ${requests}` }, null],
      [{}, 'stop']
    ])
      response.write(
        `data: ${JSON.stringify({ id: 'session-test', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason }] })}\n\n`
      )
    response.end('data: [DONE]\n\n')
  })
  await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve))
  const address = provider.address() as { port: number }
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
              name: 'Persistence fixture',
              input: ['text'],
              contextWindow: 128000,
              maxTokens: 4096
            }
          ]
        }
      }
    })
  )
  let restarted: Awaited<ReturnType<typeof electron.launch>> | undefined
  const settled = async (target: Page, id: string, count: number) => {
    await expect.poll(() => requests).toBe(count)
    await expect
      .poll(() =>
        target.evaluate(
          (sessionId) => window.piSwitch.agent.running().then((ids) => ids.includes(sessionId)),
          id
        )
      )
      .toBe(false)
    // SDK sessions write lazily; refresh the persisted index after the turn ends.
    await expect
      .poll(() =>
        target.evaluate(
          (sessionId) =>
            window.piSwitch.sessions
              .list(true)
              .then((items) => items.some((item) => item.id === sessionId)),
          id
        )
      )
      .toBe(true)
  }
  try {
    await page.evaluate(async () => {
      await window.piSwitch.models.list()
      await window.piSwitch.models.setActive({ providerKey: 'fixture', modelId: 'fixture' })
    })
    const { sessionId } = await startFixtureSession(page, {
      cwd: workspaceRoot,
      provider: 'fixture',
      modelId: 'fixture'
    })
    await page.evaluate(
      (id) =>
        window.piSwitch.agent.prompt({
          sessionId: id,
          message: 'Persist across application restart'
        }),
      sessionId
    )
    await settled(page, sessionId, 1)
    await expect
      .poll(() =>
        page.evaluate(
          (id) =>
            window.piSwitch.sessions
              .get(id)
              .then((detail) => JSON.stringify(detail.context.messages)),
          sessionId
        )
      )
      .toContain('Persistent reply 1')
    const launch = await electronApp.evaluate(() => ({
      executablePath: process.execPath,
      env: { ...process.env }
    }))
    await electronApp.close()
    restarted = await electron.launch({
      ...launch,
      args: process.env.PI_HARNESS_E2E_EXECUTABLE ? [] : [path.resolve('out/main/index.js')]
    })
    const reopened = await restarted.firstWindow()
    await reopened.waitForLoadState('domcontentloaded')
    await reopened.evaluate(() => window.piSwitch.sessions.list(true))
    const restored = await reopened.evaluate((id) => window.piSwitch.sessions.get(id), sessionId)
    expect(JSON.stringify(restored.context.messages)).toContain(
      'Persist across application restart'
    )
    await reopened.evaluate((id) => window.piSwitch.agent.start({ sessionId: id }), sessionId)
    await reopened.evaluate(
      (id) => window.piSwitch.agent.prompt({ sessionId: id, message: 'Continue after restart' }),
      sessionId
    )
    await settled(reopened, sessionId, 2)
    await expect
      .poll(() =>
        reopened.evaluate(
          (id) =>
            window.piSwitch.sessions
              .get(id)
              .then((detail) => JSON.stringify(detail.context.messages)),
          sessionId
        )
      )
      .toContain('Persistent reply 2')
    expect(requests).toBe(2)
  } finally {
    await restarted?.close()
    provider.closeAllConnections()
    await new Promise<void>((resolve) => provider.close(() => resolve()))
  }
})

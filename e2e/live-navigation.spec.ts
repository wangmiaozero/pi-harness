import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { test, expect, startFixtureSession } from './fixtures'

test('keeps navigation responsive during a real native Pi stream and persists the completed session', async ({
  page,
  electronApp,
  workspaceRoot,
  piAgentDir
}, testInfo) => {
  test.setTimeout(120000)
  let release: (() => void) | undefined
  let chunks = 0
  const server = http.createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    JSON.parse(body)
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const send = (delta: unknown, finish_reason: string | null = null) =>
      response.write(
        `data: ${JSON.stringify({ id: 'navigation', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason }] })}\n\n`
      )
    send({ role: 'assistant', content: 'Native live navigation prefix' })
    const timer = setInterval(() => {
      chunks++
      send({ content: ` chunk-${chunks}` })
    }, 16)
    response.on('close', () => clearInterval(timer))
    release = () => {
      clearInterval(timer)
      send({ content: ' Native live navigation completed' })
      send({}, 'stop')
      response.end('data: [DONE]\n\n')
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  fs.writeFileSync(
    path.join(piAgentDir, 'models.json'),
    JSON.stringify({
      providers: {
        fixture: {
          api: 'openai-completions',
          baseUrl: `http://127.0.0.1:${port}/v1`,
          apiKey: 'local-navigation-placeholder',
          models: [{ id: 'fixture', input: ['text'], contextWindow: 128000, maxTokens: 4096 }]
        }
      }
    })
  )
  fs.writeFileSync(
    path.join(piAgentDir, 'settings.json'),
    JSON.stringify({
      retry: { enabled: false },
      compaction: { enabled: false },
      packages: [],
      extensions: [],
      skills: [],
      prompts: [],
      themes: []
    })
  )
  const id = '01a126a4-0796-73ff-990a-a2be2198354e'
  const timestamp = '2026-11-03T00:00:00.000Z'
  const directory = path.join(
    piAgentDir,
    'sessions',
    `--${workspaceRoot.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`
  )
  fs.mkdirSync(directory, { recursive: true })
  const entries: unknown[] = [
    { type: 'session', version: 3, id, timestamp, cwd: workspaceRoot },
    {
      type: 'session_info',
      id: 'native-name',
      parentId: null,
      name: 'Native navigation history',
      timestamp
    }
  ]
  for (let i = 0; i < 1000; i++)
    entries.push({
      type: 'message',
      id: `history-${i}`,
      parentId: i ? `history-${i - 1}` : 'native-name',
      timestamp,
      message:
        i % 2
          ? {
              role: 'assistant',
              api: 'openai-completions',
              model: 'fixture',
              provider: 'fixture',
              content: [{ type: 'text', text: `Persisted answer ${i}` }],
              stopReason: 'stop',
              timestamp: Date.parse(timestamp) + i,
              usage: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 0,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
              }
            }
          : {
              role: 'user',
              content: i ? `Persisted question ${i}` : 'Native navigation history',
              timestamp: Date.parse(timestamp) + i
            }
    })
  const sessionFile = path.join(directory, `2026-11-03T00-00-00Z_${id}.jsonl`)
  fs.writeFileSync(sessionFile, entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n')
  try {
    await page.locator('a[href="#/workspace"]').click()
    await page.getByTestId('workspace-refresh').click()
    await page
      .getByTestId(`session-row-${id}`)
      .getByRole('button', { name: 'Native navigation history', exact: true })
      .click()
    await expect(page.locator('.message-hud')).toHaveCount(1000)
    await startFixtureSession(page, {
      sessionId: id,
      cwd: workspaceRoot,
      provider: 'fixture',
      modelId: 'fixture',
      toolNames: ['read']
    })
    await page.evaluate(
      (id) =>
        window.piSwitch.agent.prompt({ sessionId: id, message: 'Run native live navigation' }),
      id
    )
    await expect(page.getByTestId('chat-scroller')).toContainText('Native live navigation prefix')
    const samples: Array<{ destination: string; ms: number }> = []
    const destinations = [
      {
        selector: 'a[href="#/models"]',
        route: '/models',
        ready: '[data-testid="model-action-cell"]'
      },
      {
        selector: 'a[href="#/workspace"]',
        route: '/workspace',
        ready: '[data-testid="composer-editor"]'
      },
      {
        selector: 'a[data-nav-id="settings"]',
        route: '/settings/general',
        ready: '[data-testid="settings-section-general"]'
      },
      {
        selector: 'a[href="#/workspace"]',
        route: '/workspace',
        ready: '[data-testid="composer-editor"]'
      }
    ]
    for (let i = 0; i < 32; i++) {
      expect(
        await page.evaluate(
          (id) => window.piSwitch.agent.running().then((ids) => ids.includes(id)),
          id
        )
      ).toBe(true)
      const destination = destinations[i % destinations.length]
      const target = page.locator(destination.selector).first()
      await target.evaluate((element, destination) => {
        ;(window as any).__nativeNavigationFrame = new Promise<number>((resolve) => {
          element.addEventListener(
            'pointerdown',
            () => {
              const start = performance.now()
              const frame = () => {
                const ready = document.querySelector(destination.ready)
                if (location.hash === `#${destination.route}` && ready?.getClientRects().length)
                  requestAnimationFrame(() => resolve(performance.now() - start))
                else requestAnimationFrame(frame)
              }
              requestAnimationFrame(frame)
            },
            { once: true, capture: true }
          )
        })
      }, destination)
      await target.click()
      samples.push({
        destination: destination.route,
        ms: await page.evaluate(() => (window as any).__nativeNavigationFrame)
      })
    }
    release!()
    release = undefined
    await expect
      .poll(() =>
        page.evaluate((id) => window.piSwitch.agent.running().then((ids) => ids.includes(id)), id)
      )
      .toBe(false)
    await expect(page.getByTestId('chat-scroller')).toContainText(
      'Native live navigation completed'
    )
    await page.reload()
    await expect(page.getByTestId('startup-animation')).toBeHidden({ timeout: 12000 })
    await expect(page.getByTestId('chat-scroller')).toContainText(
      'Native live navigation completed'
    )
    await expect(page.locator('.message-hud')).toHaveCount(1002)
    expect(fs.readFileSync(sessionFile, 'utf8')).toContain('Native live navigation completed')
    const sorted = samples.map((sample) => sample.ms).sort((a, b) => a - b)
    const directory = process.env.PI_HARNESS_PERF_OUTPUT ?? 'out/quality'
    fs.mkdirSync(directory, { recursive: true })
    const output = path.join(directory, 'live-navigation.json')
    fs.writeFileSync(
      output,
      JSON.stringify(
        {
          samples,
          messages: 1000,
          streamIntervalMs: 16,
          chunks,
          p50: sorted[15],
          p95: sorted[30],
          max: sorted[31],
          method:
            'Production Electron, real native Pi runtime and HTTP SSE from an isolated local provider, 32 navigations verified while agent.running is true; trusted pointerdown to destination plus one animation frame. No external provider call or timing threshold.',
          runtime: await electronApp.evaluate(() => process.env.PI_HARNESS_AGENT_MODE),
          platform: process.platform,
          arch: process.arch
        },
        null,
        2
      )
    )
    await testInfo.attach('native live navigation', {
      path: output,
      contentType: 'application/json'
    })
  } finally {
    release?.()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

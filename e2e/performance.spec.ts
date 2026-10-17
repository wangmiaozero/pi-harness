import fs from 'node:fs'
import path from 'node:path'
import { test, expect } from './fixtures'
import { IPC_EVENT } from '../src/shared/ipc/channels'

test('streams into a long transcript without losing history or blocking the composer', async ({
  page,
  electronApp,
  piAgentDir,
  workspaceRoot
}, testInfo) => {
  test.setTimeout(120000)
  const sessionId = '01a126a4-0796-73ff-990a-a2be2198354e'
  const timestamp = '2026-10-13T01:00:00.000Z'
  const directory = path.join(
    piAgentDir,
    'sessions',
    `--${workspaceRoot.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`
  )
  fs.mkdirSync(directory, { recursive: true })
  const entries: unknown[] = [
    { type: 'session', version: 3, id: sessionId, timestamp, cwd: workspaceRoot }
  ]
  for (let index = 0; index < 240; index++) {
    entries.push({
      type: 'message',
      id: `entry-${index}`,
      parentId: index ? `entry-${index - 1}` : null,
      timestamp,
      message:
        index % 2 === 0
          ? {
              role: 'user',
              content: index === 0 ? 'Long transcript performance' : `Question ${index}`,
              timestamp: Date.parse(timestamp)
            }
          : {
              role: 'assistant',
              content: [
                {
                  type: 'text',
                  text: `Reply ${index}\n\n${'A source-backed explanation with **formatting** and [a link](https://example.com).\n\n'.repeat(8)}\n\n\`\`\`ts\nexport const value = ${index}\n\`\`\``
                }
              ],
              timestamp: Date.parse(timestamp)
            }
    })
  }
  fs.writeFileSync(
    path.join(directory, `${timestamp.replaceAll(':', '-')}_${sessionId}.jsonl`),
    entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n'
  )
  await page.evaluate(() => window.piSwitch.settings.set({ theme: 'dark', mascotStyle: 'none' }))
  await page.reload()
  await expect(page.getByTestId('startup-animation')).toBeHidden({ timeout: 12000 })
  await page.locator('a[href="#/workspace"]').click()
  await page.getByTestId('workspace-refresh').click()
  await page.getByText('Long transcript performance', { exact: true }).first().click()
  await expect(page.locator('.message-hud')).toHaveCount(240)
  const activeSessionId = await page.evaluate(
    async () =>
      (await window.piSwitch.sessions.list()).find(
        (session) => session.firstMessage === 'Long transcript performance'
      )!.id
  )
  // Warm up persisted Markdown and the initial session reconciliation before sampling.
  await page.waitForTimeout(1500)
  await page.evaluate(() => {
    const state = window as typeof window & { __longTasks?: number[] }
    state.__longTasks = []
    new PerformanceObserver((list) => {
      state.__longTasks!.push(...list.getEntries().map((entry) => entry.duration))
    }).observe({ type: 'longtask', buffered: false })
  })
  const profile = await electronApp.evaluate(
    async ({ BrowserWindow }, input) => {
      const contents = BrowserWindow.getAllWindows().find((window) =>
        window.webContents.getURL().includes('#/workspace')
      )!.webContents
      const debuggerApi = contents.debugger
      debuggerApi.attach('1.3')
      try {
        await debuggerApi.sendCommand('Profiler.enable')
        await debuggerApi.sendCommand('Profiler.start')
        contents.send(input.channel, { sessionId: input.sessionId, event: { type: 'agent_start' } })
        contents.send(input.channel, {
          sessionId: input.sessionId,
          event: { type: 'message_start', message: { role: 'assistant', content: [] } }
        })
        contents.send(input.channel, {
          sessionId: input.sessionId,
          event: {
            type: 'message_update',
            assistantMessageEvent: { type: 'text_start', contentIndex: 0 }
          }
        })
        for (let index = 0; index < 160; index++) {
          contents.send(input.channel, {
            sessionId: input.sessionId,
            event: {
              type: 'message_update',
              assistantMessageEvent: {
                type: 'text_delta',
                contentIndex: 0,
                delta: ` chunk-${index}`
              }
            }
          })
          await new Promise((resolve) => setTimeout(resolve, 8))
        }
        await new Promise((resolve) => setTimeout(resolve, 100))
        return (await debuggerApi.sendCommand('Profiler.stop')).profile
      } finally {
        debuggerApi.detach()
      }
    },
    { sessionId: activeSessionId, channel: IPC_EVENT.agentEvent }
  )
  await expect(page.locator('.message-hud').last()).toContainText('chunk-159')
  await expect(page.locator('.message-hud')).toHaveCount(241)
  await expect(page.locator('.message-hud').first()).toHaveCSS('content-visibility', 'auto')
  await expect(page.locator('.message-hud').last()).toHaveCSS('content-visibility', 'visible')
  const draft = page.getByTestId('composer-editor')
  await draft.fill('Composer remains usable')
  await expect(draft).toHaveText('Composer remains usable')
  const nodes = new Map(
    profile.nodes.map((node: { id: number; callFrame: { functionName: string } }) => [
      node.id,
      node.callFrame.functionName
    ])
  )
  const samples: Record<string, number> = {}
  for (let index = 0; index < profile.samples.length; index++) {
    const name = nodes.get(profile.samples[index]) as string
    samples[name] = (samples[name] ?? 0) + profile.timeDeltas[index] / 1000
  }
  const report = {
    tasks: await page.evaluate(
      () => (window as typeof window & { __longTasks: number[] }).__longTasks
    ),
    samples: Object.entries(samples)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
  }
  fs.writeFileSync(testInfo.outputPath('renderer-profile.json'), JSON.stringify(report, null, 2))
  if (process.env.PI_HARNESS_PERF_LABEL)
    fs.writeFileSync(
      path.join('task', `performance-${process.env.PI_HARNESS_PERF_LABEL}.json`),
      JSON.stringify(report, null, 2)
    )
})

test('keeps the animated background responsive without remeasuring its size each frame', async ({
  page
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.evaluate(() => window.piSwitch.settings.set({ theme: 'macos27', mascotStyle: 'none' }))
  await page.reload()
  await expect(page.getByTestId('startup-animation')).toBeHidden({ timeout: 12000 })
  const available = await page.evaluate(() => {
    if (
      document
        .querySelector('[data-testid="macos27-optics-backdrop"]')
        ?.getAttribute('data-renderer') === 'static'
    )
      return false
    const canvas = document.querySelector('.macos27-optics-backdrop__canvas') as HTMLCanvasElement
    const context = canvas.getContext('webgl2')
    if (!context) return false
    const state = window as typeof window & { __backgroundPerf: { reads: number; draws: number } }
    state.__backgroundPerf = { reads: 0, draws: 0 }
    const width = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth')!.get!
    Object.defineProperty(canvas, 'clientWidth', {
      configurable: true,
      get() {
        state.__backgroundPerf.reads++
        return width.call(canvas)
      }
    })
    const draw = context.drawArrays.bind(context)
    context.drawArrays = (...args) => {
      state.__backgroundPerf.draws++
      draw(...args)
    }
    return true
  })
  const mode = await page.getByTestId('macos27-optics-backdrop').getAttribute('data-renderer')
  if (!available) {
    expect(mode).toBe('static')
    await expect(page.locator('.macos27-optics-backdrop__canvas')).toBeHidden()
    expect(
      await page
        .getByTestId('macos27-optics-backdrop')
        .evaluate((element) => getComputedStyle(element).backgroundImage)
    ).not.toBe('none')
    return
  }
  await page.waitForTimeout(1000)
  const result = await page.evaluate(
    () =>
      (window as typeof window & { __backgroundPerf: { reads: number; draws: number } })
        .__backgroundPerf
  )
  fs.writeFileSync(testInfo.outputPath('background-profile.json'), JSON.stringify(result, null, 2))
  if (process.env.PI_HARNESS_PERF_LABEL)
    fs.writeFileSync(
      path.join('task', `background-${process.env.PI_HARNESS_PERF_LABEL}.json`),
      JSON.stringify(result, null, 2)
    )
  expect(result.draws).toBeGreaterThan(mode === 'reduced' ? 2 : 10)
  if (mode === 'reduced') expect(result.draws).toBeLessThanOrEqual(8)
  if (process.env.PI_HARNESS_PERF_LABEL !== 'before') expect(result.reads).toBeLessThanOrEqual(4)
  await page.setViewportSize({ width: 1100, height: 760 })
  await expect
    .poll(() =>
      page.evaluate(() => {
        const canvas = document.querySelector(
          '.macos27-optics-backdrop__canvas'
        ) as HTMLCanvasElement
        const reduced = canvas.parentElement?.getAttribute('data-renderer') === 'reduced'
        const ratio = reduced
          ? Math.min(1, 320 / canvas.clientWidth, 240 / canvas.clientHeight)
          : Math.min(devicePixelRatio, 1.25)
        return canvas.width === Math.round(canvas.clientWidth * ratio)
      })
    )
    .toBe(true)
})

test('keeps glass theme controls usable when graphics initialization is unavailable', async ({
  page
}, testInfo) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (type: string, options?: unknown) {
      return type === 'webgl2' ? null : original.call(this, type, options)
    } as typeof original
  })
  await page.evaluate(() =>
    window.piSwitch.settings.set({ theme: 'macos27-light', mascotStyle: 'none' })
  )
  await page.reload()
  const background = page.getByTestId('macos27-optics-backdrop')
  await expect(background).toHaveAttribute('data-renderer', 'static')
  await expect(page.getByTestId('startup-animation')).toBeHidden({ timeout: 12_000 })
  await expect(background.locator('canvas')).toBeHidden()
  expect(
    await background.evaluate((element) => getComputedStyle(element).backgroundImage)
  ).not.toBe('none')
  await page.locator('a[href="#/models"]').click()
  await expect(page.getByRole('heading', { name: /模型|Models/, exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('static-background.png') })
})

import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import { test, expect } from './fixtures'
import { IPC_EVENT } from '../src/shared/ipc/channels'

test('streams into a long transcript without losing history or blocking the composer', async ({
  page,
  electronApp,
  piAgentDir,
  workspaceRoot,
  startupMetrics
}, testInfo) => {
  test.setTimeout(240000)
  const lifecycle = process.env.PI_HARNESS_PERF_LIFECYCLE === '1'
  const mixed = process.env.PI_HARNESS_PERF_MIXED === '1'
  const messageCount = Number(process.env.PI_HARNESS_PERF_MESSAGES ?? 240)
  if (!Number.isSafeInteger(messageCount) || messageCount < 2 || messageCount > 3000)
    throw new Error('Invalid stress message count')
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
  for (let index = 0; index < messageCount; index++) {
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
  if (mixed) {
    if (messageCount % 4) throw new Error('Mixed corpus requires groups of four messages')
    for (let index = 0; index < messageCount; index++) {
      const entry = entries[index + 1] as { message: unknown }
      if (index % 4 === 1)
        entry.message = {
          role: 'assistant',
          content: [
            {
              type: 'toolCall',
              id: `tool-${index}`,
              name: 'read',
              arguments: { path: `fixture-${index}.ts` }
            }
          ],
          timestamp: Date.parse(timestamp)
        }
      if (index % 4 === 2)
        entry.message = {
          role: 'toolResult',
          toolCallId: `tool-${index - 1}`,
          toolName: 'read',
          content: [{ type: 'text', text: `export const fixture = ${index}` }],
          isError: false,
          timestamp: Date.parse(timestamp)
        }
    }
  }
  const expectedRows = mixed ? messageCount / 2 : messageCount
  fs.writeFileSync(
    path.join(directory, `${timestamp.replaceAll(':', '-')}_${sessionId}.jsonl`),
    entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n'
  )
  if (lifecycle) {
    const short = structuredClone(entries.slice(0, 3)) as Array<Record<string, unknown>>
    short[0].id = '01a126a4-0796-73ff-990a-a2be2198354f'
    ;(short[1].message as { content: string }).content = 'Short lifecycle fixture'
    fs.writeFileSync(
      path.join(
        directory,
        `${timestamp.replaceAll(':', '-')}_01a126a4-0796-73ff-990a-a2be2198354f.jsonl`
      ),
      short.map((entry) => JSON.stringify(entry)).join('\n') + '\n'
    )
  }
  await page.evaluate(() => window.piSwitch.settings.set({ theme: 'dark', mascotStyle: 'none' }))
  await page.reload()
  await expect(page.getByTestId('startup-animation')).toBeHidden({ timeout: 12000 })
  await page.locator('a[href="#/workspace"]').click()
  await page.getByTestId('workspace-refresh').click()
  // Profile initial mounting independently from streaming.
  await electronApp.evaluate(async ({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows().find((window) =>
      window.webContents.getURL().includes('#/workspace')
    )!.webContents
    contents.debugger.attach('1.3')
    await contents.debugger.sendCommand('Profiler.enable')
    await contents.debugger.sendCommand('Performance.enable')
    await contents.debugger.sendCommand('Profiler.start')
  })
  await page.evaluate(() => {
    const state = window as typeof window & { __initialTasks: number[] }
    state.__initialTasks = []
    new PerformanceObserver((list) =>
      state.__initialTasks.push(...list.getEntries().map((entry) => entry.duration))
    ).observe({ type: 'longtask', buffered: false })
  })
  const renderStarted = performance.now()
  await page.getByText('Long transcript performance', { exact: true }).first().click()
  await expect(page.locator('.message-hud')).toHaveCount(expectedRows)
  const initialRenderMs = performance.now() - renderStarted
  const initialProfile = await electronApp.evaluate(async ({ BrowserWindow, app }) => {
    const contents = BrowserWindow.getAllWindows().find((window) =>
      window.webContents.getURL().includes('#/workspace')
    )!.webContents
    try {
      const profile = (await contents.debugger.sendCommand('Profiler.stop')).profile
      const metrics = (await contents.debugger.sendCommand('Performance.getMetrics')).metrics
      const processes = app
        .getAppMetrics()
        .map(({ pid, type, memory, cpu }) => ({ pid, type, memory, cpu }))
      return { profile, metrics, processes }
    } finally {
      contents.debugger.detach()
    }
  })
  const initialTasks = await page.evaluate(
    () => (window as typeof window & { __initialTasks: number[] }).__initialTasks
  )
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
  await expect(page.locator('.message-hud')).toHaveCount(expectedRows)
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
    environment: {
      os: os.release(),
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      electron: await electronApp.evaluate(() => process.versions.electron),
      application: await electronApp.evaluate(({ app }) => app.getVersion()),
      mode: 'compiled production bundle, isolated test profile, OS cache not flushed'
    },
    messageCount,
    mixed,
    initialRenderMs,
    initialProfile,
    initialTasks,
    startupMetrics,
    heap: await page.evaluate(() =>
      (
        performance as Performance & {
          memory?: { usedJSHeapSize: number; totalJSHeapSize: number }
        }
      ).memory
        ? {
            used: (performance as Performance & { memory: { usedJSHeapSize: number } }).memory
              .usedJSHeapSize
          }
        : null
    ),
    tasks: await page.evaluate(
      () => (window as typeof window & { __longTasks: number[] }).__longTasks
    ),
    samples: Object.entries(samples)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
  }
  const rail = page.getByTestId('minimap-rail')
  // Dense rails contain subpixel markers: keyboard activation can select an
  // exact turn while a physical pointer selects the nearest visible dash.
  const activate = async (last: boolean) => {
    const marker = last ? rail.getByRole('button').last() : rail.getByRole('button').first()
    if (messageCount <= 100) await marker.click()
    else {
      await marker.focus()
      await marker.press('Enter')
    }
  }
  await activate(false)
  await expect(page.locator('.message-hud').first()).toBeInViewport()
  await activate(true)
  await expect(page.locator('.message-hud').last()).toBeInViewport()
  if (lifecycle) {
    await electronApp.evaluate(
      ({ BrowserWindow }, input) => {
        const contents = BrowserWindow.getAllWindows().find((window) =>
          window.webContents.getURL().includes('#/workspace')
        )!.webContents
        contents.send(input.channel, {
          sessionId: input.sessionId,
          event: { type: 'agent_settled' }
        })
      },
      { sessionId: activeSessionId, channel: IPC_EVENT.agentEvent }
    )
    const topStarted = performance.now()
    await page.getByTestId('chat-scroll-top').click()
    await expect(page.locator('.message-hud').first()).toBeInViewport()
    const topMs = performance.now() - topStarted
    const short = page
      .getByTestId('workspace-session-tree')
      .getByRole('button', { name: 'Short lifecycle fixture', exact: true })
    const long = page
      .getByTestId('workspace-session-tree')
      .getByRole('button', { name: 'Long transcript performance', exact: true })
    const switching = performance.now()
    for (let index = 0; index < 20; index++) await (index % 2 ? short : long).click()
    await expect(page.locator('.message-hud')).toHaveCount(2)
    await expect(page.locator('.message-hud').first()).toContainText('Short lifecycle fixture')
    const switchBurstMs = performance.now() - switching
    await page.getByTestId('workspace-new-session').click()
    await expect(page.locator('.message-hud')).toHaveCount(0)
    const releasedHeap = await electronApp.evaluate(async ({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows().find((window) =>
        window.webContents.getURL().includes('#/workspace')
      )!.webContents
      contents.debugger.attach('1.3')
      try {
        await contents.debugger.sendCommand('HeapProfiler.collectGarbage')
        return await contents.debugger.sendCommand('Runtime.getHeapUsage')
      } finally {
        contents.debugger.detach()
      }
    })
    Object.assign(report, {
      lifecycle: {
        topMs,
        switchBurstMs,
        switches: 20,
        releasedHeap,
        method:
          'Top navigation and 20 rapid switches; heap after unloading into a new draft is a separate forced-GC observation, not a leak-free claim.'
      }
    })
  }
  fs.writeFileSync(testInfo.outputPath('renderer-profile.json'), JSON.stringify(report, null, 2))
  const metricsDirectory = process.env.PI_HARNESS_PERF_OUTPUT ?? 'out/quality'
  fs.mkdirSync(metricsDirectory, { recursive: true })
  fs.writeFileSync(
    path.join(
      metricsDirectory,
      `long-session-${process.env.PI_HARNESS_PERF_LABEL ?? 'current'}-${messageCount}${mixed ? '-mixed' : ''}.json`
    ),
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

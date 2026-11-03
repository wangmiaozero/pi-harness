import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { test, expect } from './fixtures'
import { IPC_EVENT } from '../src/shared/ipc/channels'

// Opt-in: profiles affect timing and this is a measurement, not an ordinary smoke test.
test('profiles repeated desktop navigation with and without streaming', async ({
  page,
  electronApp,
  piAgentDir,
  workspaceRoot
}, testInfo) => {
  test.skip(process.env.PI_HARNESS_NAV_BENCHMARK !== '1', 'Run pnpm benchmark:navigation')
  test.setTimeout(240000)
  const streamIntervalMs = Number(process.env.PI_HARNESS_NAV_STREAM_MS ?? 80)
  if (!Number.isSafeInteger(streamIntervalMs) || streamIntervalMs < 8 || streamIntervalMs > 1000)
    throw new Error('Invalid stream interval')
  const count = Number(process.env.PI_HARNESS_NAV_MESSAGES ?? 1000)
  if (!Number.isSafeInteger(count) || count < 2 || count > 3000)
    throw new Error('Invalid message count')
  const id = '01a126a4-0796-73ff-990a-a2be2198354e'
  const timestamp = '2026-10-13T01:00:00.000Z'
  const directory = path.join(
    piAgentDir,
    'sessions',
    `--${workspaceRoot.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`
  )
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(path.join(workspaceRoot, 'navigation.ts'), 'export const navigation = true\n')
  const entries: unknown[] = [{ type: 'session', version: 3, id, timestamp, cwd: workspaceRoot }]
  for (let index = 0; index < count; index++)
    entries.push({
      type: 'message',
      id: `entry-${index}`,
      parentId: index ? `entry-${index - 1}` : null,
      timestamp,
      message:
        index % 2 === 0
          ? {
              role: 'user',
              content: index ? `Question ${index}` : 'Navigation performance fixture',
              timestamp: Date.parse(timestamp)
            }
          : {
              role: 'assistant',
              content: [
                {
                  type: 'text',
                  text: `Reply ${index}\n\n${'Explanation with **formatting**.\n\n'.repeat(8)}\n\n\`\`\`ts\nexport const value = ${index}\n\`\`\``
                }
              ],
              timestamp: Date.parse(timestamp)
            }
    })
  fs.writeFileSync(
    path.join(directory, `2026-10-13T01-00-00Z_${id}.jsonl`),
    entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n'
  )
  await page.locator('a[href="#/workspace"]').click()
  await page.getByTestId('workspace-refresh').click()
  await page
    .getByTestId(`session-row-${id}`)
    .getByRole('button', { name: 'Navigation performance fixture', exact: true })
    .click()
  await expect(page.locator('.message-hud')).toHaveCount(count)
  const buildHash = createHash('sha256')
  for (const directory of ['out/main', 'out/preload', 'out/renderer/assets']) {
    for (const file of fs.readdirSync(directory).sort()) {
      if (file.endsWith('.js'))
        buildHash.update(file).update(fs.readFileSync(path.join(directory, file)))
    }
  }
  const buildDigest = buildHash.digest('hex')
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.start')
  await cdp.send('Profiler.startPreciseCoverage', { callCount: true, detailed: true })
  await electronApp.evaluate(async ({ ipcMain }) => {
    const state = globalThis as any
    const { monitorEventLoopDelay } = process.getBuiltinModule('perf_hooks')!
    state.__interactionMain = {
      ipc: [],
      events: {},
      started: performance.now(),
      cpu: process.cpuUsage(),
      delay: monitorEventLoopDelay({ resolution: 10 })
    }
    state.__interactionMain.delay.enable()
    const { Session } = process.getBuiltinModule('inspector')!
    const profiler = new Session()
    profiler.connect()
    await new Promise<void>((resolve, reject) =>
      profiler.post('Profiler.enable', (error: Error | null) => (error ? reject(error) : resolve()))
    )
    await new Promise<void>((resolve, reject) =>
      profiler.post('Profiler.start', (error: Error | null) => (error ? reject(error) : resolve()))
    )
    state.__interactionMain.profiler = profiler
    const handlers = (ipcMain as any)._invokeHandlers as Map<string, (...args: any[]) => any>
    for (const [channel, handler] of [...handlers]) {
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, async (...args: any[]) => {
        const start = performance.now()
        const result = await handler(...args)
        // Encoded JSON bytes are a reproducible DTO-size estimate, not wire bytes.
        state.__interactionMain.ipc.push({
          channel,
          ms: performance.now() - start,
          bytes: Buffer.byteLength(JSON.stringify(result) ?? '')
        })
        return result
      })
    }
  })
  await page.evaluate(() => {
    const state = window as any
    state.__interaction = {
      samples: [],
      tasks: [],
      pending: null,
      frames: [],
      lastFrame: performance.now()
    }
    const data = state.__interaction
    data.observer = new PerformanceObserver((list) =>
      data.tasks.push(
        ...list.getEntries().map((entry) => ({
          start: entry.startTime,
          ms: entry.duration,
          attribution: (entry as any).attribution
        }))
      )
    )
    data.observer.observe({ type: 'longtask' })
    const router = (document.getElementById('app') as any).__vue_app__.config.globalProperties
      .$router
    router.afterEach(() => {
      if (data.pending) data.pending.routeMs = performance.now() - data.pending.started
    })
    document.addEventListener(
      'pointerdown',
      (event) => {
        const target = (event.target as Element).closest('[data-perf-target]') as HTMLElement | null
        if (!target) return
        data.pending = {
          ...data.next,
          started: performance.now(),
          feedbackMs: null,
          routeMs: null,
          interactiveMs: null
        }
      },
      true
    )
    const frame = () => {
      const now = performance.now()
      data.frames.push(now - data.lastFrame)
      data.lastFrame = now
      const pending = data.pending
      if (pending) {
        const element = document.querySelector(pending.ready) as HTMLElement | null
        const target = document.querySelector('[data-perf-target]')
        const selected = target?.matches(
          '.router-link-active, [aria-selected="true"], [aria-expanded="true"], [data-state="open"], [data-navigation-pending="true"]'
        )
        if (
          pending.feedbackMs === null &&
          (selected || (element && element.getClientRects().length))
        )
          pending.feedbackMs = now - pending.started
        if (
          element &&
          element.getClientRects().length &&
          (pending.route === null || router.currentRoute.value.path === pending.route)
        ) {
          // One additional animation frame allows a task/input opportunity after mounting.
          if (pending.painted) {
            pending.interactiveMs = now - pending.started
            pending.routeMs ??= 0
            data.samples.push(pending)
            data.pending = null
          } else pending.painted = true
        }
      }
      data.raf = requestAnimationFrame(frame)
    }
    data.raf = requestAnimationFrame(frame)
  })
  const memory = async () => {
    await cdp.send('HeapProfiler.collectGarbage')
    const heap = await cdp.send('Runtime.getHeapUsage')
    const metrics = await cdp.send('Performance.getMetrics')
    const processes = await electronApp.evaluate(({ app }) =>
      app.getAppMetrics().map(({ type, memory, cpu }) => ({ type, memory, cpu }))
    )
    return { heap, metrics, processes }
  }
  const before = await memory()
  const surfaces = [
    {
      name: 'models',
      selector: 'a[href="#/models"]',
      route: '/models',
      ready: '[data-testid="model-action-cell"]'
    },
    {
      name: 'capabilities',
      selector: 'a[href="#/skills"]',
      route: '/skills',
      ready: '[role="tablist"]',
      overflow: true
    },
    {
      name: 'ai-sessions',
      selector: 'a[href="#/ai-sessions"]',
      route: '/ai-sessions',
      ready: '[data-testid="universal-sessions"]',
      overflow: true
    },
    {
      name: 'git',
      selector: 'a[href="#/git"]',
      route: '/git',
      ready: '[data-testid="git-view"]',
      overflow: true
    },
    {
      name: 'settings',
      selector: 'a[data-nav-id="settings"]',
      route: '/settings/general',
      ready: '[data-testid="settings-section-general"]'
    },
    {
      name: 'chat',
      selector: 'a[href="#/workspace"]',
      route: '/workspace',
      ready: '[data-testid="composer-editor"]'
    },
    {
      name: 'files',
      selector: '[data-testid="workspace-toggle-files"]',
      route: null,
      ready: '[data-testid="workspace-files-panel"]'
    },
    {
      name: 'harness',
      selector: '[data-testid="workspace-section-tools"]',
      route: null,
      ready: '[data-testid="harness-console"]'
    },
    {
      name: 'workspace',
      selector: '[data-testid="workspace-section-workspace"]',
      route: null,
      ready: '[data-testid="composer-editor"]'
    }
  ]
  let failure: unknown
  try {
    for (const streaming of [false, true]) {
      if (streaming)
        await electronApp.evaluate(
          ({ BrowserWindow }, { id, channel, intervalMs }) => {
            const contents = BrowserWindow.getAllWindows().find((w) =>
              w.webContents.getURL().includes('#/workspace')
            )!.webContents
            contents.send(channel, { sessionId: id, event: { type: 'agent_start' } })
            contents.send(channel, {
              sessionId: id,
              event: { type: 'message_start', message: { role: 'assistant', content: [] } }
            })
            contents.send(channel, {
              sessionId: id,
              event: {
                type: 'message_update',
                assistantMessageEvent: { type: 'text_start', contentIndex: 0 }
              }
            })
            ;(globalThis as any).__navStream = setInterval(() => {
              if (contents.isDestroyed()) {
                clearInterval((globalThis as any).__navStream)
                return
              }
              contents.send(channel, {
                sessionId: id,
                event: {
                  type: 'message_update',
                  assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: ' stream' }
                }
              })
            }, intervalMs)
          },
          {
            id,
            channel: IPC_EVENT.agentEvent,
            intervalMs: streamIntervalMs
          }
        )
      for (let cycle = 0; cycle < 4; cycle++) {
        for (const surface of surfaces) {
          process.stdout.write(
            `Navigation ${streaming ? 'streaming' : 'idle'} ${cycle + 1}: ${surface.name}\n`
          )
          if (surface.overflow && !(await page.getByTestId('navigation-more-menu').isVisible()))
            await page.getByTestId('navigation-more').click()
          // Files panel is preserved by the workspace store across route mounts.
          if (
            surface.name === 'files' &&
            (await page.getByTestId('workspace-files-panel').isVisible())
          )
            await page.getByTestId('workspace-toggle-files').click()
          const target = page.locator(surface.selector).first()
          await target.waitFor({ state: 'visible' })
          const completed = await page.evaluate(
            ({ surface, cycle, streaming }) => {
              document.querySelector('[data-perf-target]')?.removeAttribute('data-perf-target')
              document.querySelector(surface.selector)!.setAttribute('data-perf-target', '')
              const data = (window as any).__interaction
              data.next = {
                name: surface.name,
                route: surface.route,
                ready: surface.ready,
                cold: !streaming && cycle === 0,
                streaming
              }
              return data.samples.length
            },
            { surface, cycle, streaming }
          )
          await target.click()
          await page.waitForFunction(
            (n) => (window as any).__interaction.samples.length > n,
            completed,
            { timeout: 15000 }
          )
          if (surface.overflow) await expect(page.getByTestId('navigation-more-menu')).toBeHidden()
        }
      }
    }
  } catch (cause) {
    failure = cause
  } finally {
    await electronApp.evaluate(() => clearInterval((globalThis as any).__navStream))
  }
  const after = await memory()
  const rendererProfile = (await cdp.send('Profiler.stop')).profile
  const coverage = (await cdp.send('Profiler.takePreciseCoverage')).result
  await cdp.send('Profiler.stopPreciseCoverage')
  const main = await electronApp.evaluate(async () => {
    const data = (globalThis as any).__interactionMain
    data.delay.disable()
    const cpu = process.cpuUsage(data.cpu)
    const elapsedMs = performance.now() - data.started
    const profile = await new Promise((resolve, reject) =>
      data.profiler.post('Profiler.stop', (error: Error | null, result: any) =>
        error ? reject(error) : resolve(result.profile)
      )
    )
    data.profiler.disconnect()
    return {
      ipc: data.ipc,
      cpu,
      elapsedMs,
      cpuPercent: (cpu.user + cpu.system) / elapsedMs / 10,
      eventLoopMs: {
        p50: data.delay.percentile(50) / 1e6,
        p95: data.delay.percentile(95) / 1e6,
        max: data.delay.max / 1e6
      },
      profile
    }
  })
  const renderer = await page.evaluate(() => {
    const data = (window as any).__interaction
    data.observer.disconnect()
    cancelAnimationFrame(data.raf)
    return { samples: data.samples, tasks: data.tasks, frames: data.frames }
  })
  const distribution = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b)
    return {
      n: sorted.length,
      p50: sorted[Math.ceil(sorted.length * 0.5) - 1],
      p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
      max: sorted.at(-1)
    }
  }
  const summary: Record<string, unknown> = {}
  for (const streaming of [false, true])
    for (const surface of ['all', ...surfaces.map((s) => s.name)]) {
      const samples = renderer.samples.filter(
        (s: any) => s.streaming === streaming && (surface === 'all' || s.name === surface)
      )
      summary[`${streaming ? 'streaming' : 'idle'}:${surface}`] = Object.fromEntries(
        ['feedbackMs', 'routeMs', 'interactiveMs'].map((key) => [
          key,
          distribution(samples.map((s: any) => s[key]))
        ])
      )
    }
  const output = path.resolve(
    process.env.PI_HARNESS_PERF_OUTPUT ?? 'out/quality',
    `navigation-${process.env.PI_HARNESS_PERF_LABEL ?? 'current'}.json`
  )
  fs.mkdirSync(path.dirname(output), { recursive: true })
  const report = {
    buildDigest,
    completed: !failure,
    failure: failure ? String(failure) : null,
    environment: {
      platform: process.platform,
      arch: process.arch,
      os: os.release(),
      cpu: os.cpus()[0]?.model,
      node: process.version,
      messages: count,
      streamIntervalMs,
      electron: await electronApp.evaluate(() => process.versions.electron)
    },
    method:
      'Production bundle; trusted pointerdown to first selected-control frame and destination + next animation frame (UI readiness proxy). Route completion via router.afterEach. 36 navigations per idle/streaming mode. First cycle cold modules, OS caches not flushed. Synthetic ordered agent events (interval in environment.streamIntervalMs) (no external provider). CDP CPU sampling and precise function coverage enabled in both candidates. Forced-GC heaps before/after; not a proof of absence of long-term leaks. IPC JSON size estimate excludes requests and broadcast payloads. Main CPU process.cpuUsage is entire Main interval; Renderer CPU/process snapshots and task duration metrics separate. Function coverage provides compiled render execution counts, not Vue dev-mode reactive timings.',
    summary,
    coldHot: Object.fromEntries(
      [false, true].map((cold) => [
        cold ? 'firstVisit' : 'revisit',
        distribution(
          renderer.samples
            .filter((sample: any) => sample.cold === cold)
            .map((sample: any) => sample.interactiveMs)
        )
      ])
    ),
    before,
    after,
    renderer,
    main,
    rendererProfile,
    renderFunctions: coverage.flatMap((script: any) =>
      script.functions
        .filter((fn: any) => /render|computed|ReactiveEffect/.test(fn.functionName))
        .map((fn: any) => ({
          url: script.url.replace(/^.*\/assets\//, ''),
          name: fn.functionName,
          calls: fn.ranges[0]?.count
        }))
    )
  }
  fs.writeFileSync(output, JSON.stringify(report, null, 2))
  await testInfo.attach('navigation profile', { path: output, contentType: 'application/json' })
  if (failure) throw failure
  expect(renderer.samples).toHaveLength(72)
})

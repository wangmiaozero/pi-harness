import { IPC_INVOKE } from '../src/shared/ipc/channels'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { test, expect } from './fixtures'

test('installs a local plugin through Harness, denies code trust, then enables, disables and uninstalls without a session', async ({
  page,
  electronApp
}) => {
  const directory = path.resolve('examples/harness-plugins/run-metrics')
  await electronApp.evaluate(({ dialog }, directory) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] })
    dialog.showMessageBox = async (options) => {
      ;(globalThis as typeof globalThis & { pluginWarning?: string }).pluginWarning = options.detail
      return { response: 0, checkboxChecked: false }
    }
  }, directory)
  await page.locator('a[href="#/workspace"]').click()
  await page.getByTestId('workspace-section-tools').click()
  await page.getByRole('button', { name: /Harness 插件|Harness Plugins/, exact: true }).click()
  const panel = page.getByTestId('harness-plugins-panel')
  await panel.getByTestId('harness-plugin-install').click()
  const card = panel.getByTestId('harness-plugin-card')
  await expect(card).toContainText('Run Metrics')
  await card.getByTestId('harness-plugin-toggle').click()
  await expect(panel.getByRole('alert')).toContainText(/denied/)
  expect(
    await electronApp.evaluate(
      () => (globalThis as typeof globalThis & { pluginWarning?: string }).pluginWarning
    )
  ).toMatch(/不是安全沙箱|NOT a security sandbox/)
  expect(
    await page.evaluate(() => window.piSwitch.harnessPlugins.list().then((list) => list[0].enabled))
  ).toBe(false)
  await electronApp.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
  })
  await card.getByTestId('harness-plugin-toggle').click()
  await expect(card.getByTestId('harness-plugin-status')).toHaveAttribute('data-status', 'active')
  await card.getByTestId('harness-plugin-toggle').click()
  await expect(card.getByTestId('harness-plugin-status')).toHaveAttribute('data-status', 'disabled')
  await card.getByRole('button', { name: /卸载|Uninstall/, exact: true }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /确认|Confirm|卸载|Uninstall/, exact: true })
    .click()
  await expect(panel.getByTestId('harness-plugin-card')).toHaveCount(0)
  // Renderer-supplied paths/trust cannot replace the Main-owned picker or approval.
  const malformed = await electronApp.evaluate(async ({ ipcMain, BrowserWindow }, channel) => {
    const window = BrowserWindow.getAllWindows().find(
      (w) => !w.webContents.getURL().includes('overlay.html')
    )!
    const handlers = (
      ipcMain as unknown as {
        _invokeHandlers: Map<string, (event: unknown, input: unknown) => Promise<{ ok: boolean }>>
      }
    )._invokeHandlers
    return handlers.get(channel)!(
      { sender: window.webContents, senderFrame: window.webContents.mainFrame },
      { directory: '/tmp', trusted: true }
    )
  }, IPC_INVOKE.harnessPluginsInstall)
  expect(malformed.ok).toBe(false)
})

test('runs all SDK examples through real Electron processes and the native Pi runtime using a local provider', async ({
  page,
  electronApp,
  piAgentDir,
  workspaceRoot
}) => {
  const provider = http.createServer(async (request, response) => {
    for await (const chunk of request) void chunk
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    for (const [delta, finish] of [
      [{ role: 'assistant', content: 'Plugin fixture reply' }, null],
      [{}, 'stop']
    ] as const) {
      response.write(
        `data: ${JSON.stringify({ id: 'plugin-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
      )
    }
    response.end('data: [DONE]\n\n')
  })
  await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', resolve))
  const address = provider.address()
  if (!address || typeof address === 'string') throw new Error('Missing local provider')
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
              name: 'Plugin fixture',
              reasoning: false,
              input: ['text'],
              contextWindow: 128000,
              maxTokens: 4096
            }
          ]
        }
      }
    })
  )
  try {
    await electronApp.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
    })
    for (const name of ['run-metrics', 'quality-evaluator', 'team-template']) {
      await electronApp.evaluate(
        ({ dialog }, directory) => {
          dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] })
        },
        path.resolve('examples/harness-plugins', name)
      )
      const descriptor = await page.evaluate(() => window.piSwitch.harnessPlugins.installLocal())
      expect(descriptor?.enabled).toBe(false)
      await page.evaluate(
        (id) => window.piSwitch.harnessPlugins.setEnabled(id, true),
        descriptor!.manifest.id
      )
    }
    expect(
      await page.evaluate(() =>
        window.piSwitch.harnessPlugins.list().then((list) => list.map((p) => p.status))
      )
    ).toEqual(['active', 'active', 'active'])
    await page.evaluate(async () => {
      await window.piSwitch.models.list()
      await window.piSwitch.models.setActive({ providerKey: 'fixture', modelId: 'fixture' })
    })
    await page.locator('a[href="#/workspace"]').click()
    await page.getByTestId('composer-editor').fill('Harmless local plugin test')
    await page.getByTestId('composer-editor').press('Enter')
    await expect(page.locator('.chat-scroller')).toContainText('Plugin fixture reply', {
      timeout: 45000
    })
    const session = await page.evaluate(() =>
      window.piSwitch.sessions.list(true).then(([item]) => item)
    )
    await expect
      .poll(() =>
        page.evaluate(
          (id) => window.piSwitch.harness.listRuns(id).then((runs) => runs[0]?.status),
          session.id
        )
      )
      .toBe('success')
    const run = await page.evaluate(
      (id) => window.piSwitch.harness.listRuns(id).then((runs) => runs[0]),
      session.id
    )
    const result = await page.evaluate(
      ({ sessionId, runId }) =>
        window.piSwitch.harnessPlugins.evaluate(
          'org.pi-harness.quality-evaluator',
          'quality',
          sessionId,
          runId
        ),
      { sessionId: session.id, runId: run.id }
    )
    expect(result).toMatchObject({ evaluatorId: 'quality', score: 100, status: 'passed' })
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.piSwitch.harnessPlugins
            .list()
            .then((list) =>
              list[0].diagnostics.some(
                (d) => d.code === 'PLUGIN_LOG' && d.message.includes('Run metrics')
              )
            )
        )
      )
      .toBe(true)
    const output = path.join(workspaceRoot, 'plugin-trace.json')
    await electronApp.evaluate(({ dialog }, output) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: output })
    }, output)
    expect(
      await page.evaluate(
        ({ sessionId, runId }) =>
          window.piSwitch.harnessPlugins.exportTrace(
            'org.pi-harness.quality-evaluator',
            'json-trace',
            sessionId,
            runId
          ),
        { sessionId: session.id, runId: run.id }
      )
    ).toBe(true)
    const trace = JSON.parse(fs.readFileSync(output, 'utf8'))
    expect(trace.trace.runId).toBe(run.id)
    expect(JSON.stringify(trace)).not.toContain('Harmless local plugin test')
    await electronApp.evaluate(({ dialog }, directory) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] })
    }, workspaceRoot)
    const orchestrationId = await page.evaluate(() =>
      window.piSwitch.harnessPlugins.applyTeam('org.pi-harness.team-template', 'development-review')
    )
    const snapshot = await page.evaluate(
      (id) => window.piSwitch.orchestration.snapshot(id!),
      orchestrationId
    )
    expect(snapshot.orchestration.status).toBe('pending')
    expect(snapshot.tasks).toHaveLength(3)
    expect(snapshot.tasks.find((t) => t.reviewRequired)?.title).toBe('Review the change')
    expect(snapshot.agents.every((a) => a.runCount === 0)).toBe(true)
  } finally {
    provider.closeAllConnections()
    await new Promise<void>((resolve) => provider.close(() => resolve()))
  }
})

test('keeps Electron and Pi services available after a trusted plugin process exits during activation', async ({
  page,
  electronApp,
  workspaceRoot
}) => {
  const source = path.join(workspaceRoot, 'exiting-plugin')
  fs.mkdirSync(source)
  fs.writeFileSync(
    path.join(source, 'plugin.json'),
    JSON.stringify({
      id: 'org.example.exiting',
      name: 'Exit fixture',
      version: '1.0.0',
      apiVersion: '^1.0.0',
      author: 'Test fixture',
      description: 'Explicit process exit fixture',
      entry: 'main.mjs',
      permissions: [],
      contributions: {}
    })
  )
  fs.writeFileSync(path.join(source, 'main.mjs'), 'export default {activate(){process.exit(17)}}')
  await electronApp.evaluate(({ dialog }, source) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] })
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
  }, source)
  await page.evaluate(() => window.piSwitch.harnessPlugins.installLocal())
  const rejected = await page.evaluate(async () => {
    try {
      await window.piSwitch.harnessPlugins.setEnabled('org.example.exiting', true)
      return false
    } catch {
      return true
    }
  })
  expect(rejected).toBe(true)
  const state = await page.evaluate(() =>
    window.piSwitch.harnessPlugins.list().then(([plugin]) => plugin)
  )
  expect(state.status).toBe('failed')
  expect(state.diagnostics.some((d) => d.code === 'PLUGIN_PROCESS_EXIT')).toBe(true)
  expect(await page.evaluate(() => window.piSwitch.settings.get())).toBeTruthy()
  expect(await page.evaluate(() => window.piSwitch.sessions.list())).toEqual([])
  await page.evaluate(() => window.piSwitch.harnessPlugins.uninstall('org.example.exiting'))
  expect(await page.evaluate(() => window.piSwitch.harnessPlugins.list())).toEqual([])
})

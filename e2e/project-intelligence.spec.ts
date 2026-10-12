import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { test, expect } from './fixtures'
import { clickArchitectureControl, expectArchitectureDockToFit } from './architecture-controls'
import { _electron as electron } from '@playwright/test'

test('explores all map pages, packages, localized controls and project-specific exclusions', async ({
  page,
  electronApp,
  workspaceRoot,
  testUserData
}, testInfo) => {
  test.setTimeout(180000)
  fs.writeFileSync(
    path.join(workspaceRoot, 'package.json'),
    '{"name":"workspace","workspaces":["packages/*"]}'
  )
  fs.mkdirSync(path.join(workspaceRoot, 'packages/api'), { recursive: true })
  fs.writeFileSync(
    path.join(workspaceRoot, 'packages/api/package.json'),
    '{"name":"api","main":"./service.ts"}'
  )
  fs.writeFileSync(path.join(workspaceRoot, 'packages/api/service.ts'), 'export const service=1')
  for (let i = 0; i < 52; i++)
    fs.writeFileSync(
      path.join(workspaceRoot, `module-${String(i).padStart(2, '0')}.ts`),
      i === 51 ? "import './module-00'" : 'export const value=1'
    )
  await expect(page.getByTestId('startup-animation')).toBeHidden({ timeout: 12000 })
  await page.locator('a[href="#/workspace"]').click()
  await electronApp.evaluate(({ dialog }, root) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] })
  }, workspaceRoot)
  await page.getByTestId('workspace-import-project').click()
  await page.getByTestId('workspace-architecture').click()
  await page.getByTestId('architecture-analysis-options-toggle').click()
  const excluded = page.getByTestId('architecture-exclusions')
  await page
    .getByTestId('project-intelligence')
    .locator('details > summary')
    .filter({ hasText: /Excluded paths|排除路径/ })
    .click()
  await excluded.fill('not-scanned')
  await page.getByTestId('analyze-project').click()
  await expect(page.getByTestId('architecture-status')).toContainText(/complete|完成/, {
    timeout: 45000
  })
  await expect(page.getByTestId('architecture-module')).toHaveCount(55)
  await clickArchitectureControl(electronApp, 'next')
  const nativeNodes = () =>
    electronApp.evaluate(async ({ webContents }) => {
      const view = webContents
        .getAllWebContents()
        .find((w) => w.getURL().startsWith('pi-architecture:'))!
      return view.executeJavaScript(
        '[...new Set([...document.querySelectorAll("[data-node-id]")].map(n=>n.dataset.nodeId))].length'
      )
    })
  await expect.poll(nativeNodes).toBe(7)
  await page.getByTestId('architecture-module').filter({ hasText: 'module-51.ts' }).click()
  await page.getByTestId('architecture-focus').click()
  await expect.poll(nativeNodes).toBe(2)
  const htmlPath = path.join(testUserData, 'focused.html')
  await electronApp.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, htmlPath)
  await page.getByRole('button', { name: /Export HTML|导出 HTML/ }).click()
  await expect.poll(() => fs.existsSync(htmlPath)).toBe(true)
  expect(fs.readFileSync(htmlPath, 'utf8')).toContain('module-51.ts')
  const pngPath = path.join(testUserData, 'focused.png')
  await electronApp.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, pngPath)
  await page.getByRole('button', { name: /Export view as PNG|导出当前视图 PNG/ }).click()
  await expect.poll(() => fs.existsSync(pngPath)).toBe(true)
  fs.copyFileSync(pngPath, testInfo.outputPath('focused-map.png'))
  await page.getByTestId('architecture-packages').selectOption('packages/api/package.json')
  await expect(page.getByTestId('architecture-module')).toHaveCount(2)
  const window = await electronApp.browserWindow(page)
  await window.evaluate((w) => w.setSize(1000, 900))
  const copies = [
    ['en-US', 'Project Intelligence', 'Fullscreen'],
    ['zh-CN', '项目智能理解', '全屏'],
    ['zh-TW', '專案智慧理解', '全螢幕'],
    ['ja-JP', 'プロジェクト分析', '全画面'],
    ['ko-KR', '프로젝트 분석', '전체 화면'],
    ['ru-RU', 'Анализ проекта', 'Полный экран'],
    ['fr-FR', 'Analyse du projet', 'Plein écran'],
    ['de-DE', 'Projektanalyse', 'Vollbild']
  ] as const
  for (const [language, title, fullscreenLabel] of copies) {
    await page.evaluate(
      (language) => window.piSwitch!.settings.set({ language, theme: 'light' }),
      language
    )
    await page.reload()
    await expect(page.getByTestId('startup-animation')).toBeHidden({ timeout: 12000 })
    await page.getByTestId('workspace-architecture').click()
    await expect(page.getByTestId('project-intelligence')).toContainText(title)
    await expect
      .poll(() =>
        electronApp.evaluate(async ({ webContents }) => {
          const view = webContents
            .getAllWebContents()
            .find((view) => view.getURL().startsWith('pi-architecture:'))
          if (!view) return null
          return view.executeJavaScript(
            'document.querySelector("[data-testid=architecture-fullscreen]")?.getAttribute("aria-label")'
          )
        })
      )
      .toBe(fullscreenLabel)
    const dockOverflow = await electronApp.evaluate(async ({ webContents }) => {
      const view = webContents
        .getAllWebContents()
        .find((view) => view.getURL().startsWith('pi-architecture:'))!
      return view.executeJavaScript(`(()=>{
        const dock=document.querySelector('.diagram-nav');
        const box=dock.getBoundingClientRect();
        const label=document.querySelector('[data-testid=architecture-fullscreen] span');
        const text=document.createRange();text.selectNodeContents(label);
        return [...dock.querySelectorAll('button')].filter(button=>{
          if(!button.getClientRects().length)return false;
          const rect=button.getBoundingClientRect();
          return rect.left<0||rect.top<0||rect.right>innerWidth+1||rect.bottom>innerHeight+1||rect.right>box.right+1||rect.left<box.left-1;
        }).length + (text.getClientRects().length!==1?1:0);
      })()`)
    })
    expect(dockOverflow).toBe(0)
    await expectArchitectureDockToFit(electronApp)
    await clickArchitectureControl(electronApp, 'fullscreen')
    await expect
      .poll(() => page.evaluate(() => document.fullscreenElement?.id))
      .toBe('pi-architecture-panel')
    await expect
      .poll(() =>
        electronApp.evaluate(async ({ webContents }) => {
          const view = webContents
            .getAllWebContents()
            .find((view) => view.getURL().startsWith('pi-architecture:'))!
          return view.executeJavaScript(
            'document.querySelector("[data-testid=architecture-fullscreen]")?.getAttribute("aria-pressed")'
          )
        })
      )
      .toBe('true')
    await expectArchitectureDockToFit(electronApp)
    await clickArchitectureControl(electronApp, 'fullscreen')
    await expect.poll(() => page.evaluate(() => document.fullscreenElement?.id ?? null)).toBeNull()
    expect(
      await page
        .getByTestId('project-intelligence')
        .evaluate((element) => element.scrollWidth <= element.clientWidth + 1)
    ).toBe(true)
    const overflow = await page
      .getByTestId('project-intelligence')
      .locator('.ui-button')
      .evaluateAll(
        (buttons) => buttons.filter((button) => button.scrollWidth > button.clientWidth + 2).length
      )
    expect(overflow).toBe(0)
  }
  await expect
    .poll(() =>
      electronApp.evaluate(async ({ webContents }) => {
        const view = webContents
          .getAllWebContents()
          .find((w) => w.getURL().startsWith('pi-architecture:'))!
        return view.executeJavaScript('document.documentElement.dataset.theme')
      })
    )
    .toBe('light')
  await page.evaluate(() => window.piSwitch!.settings.set({ language: 'en-US', theme: 'dark' }))
  await page.reload()
  await expect(page.getByTestId('startup-animation')).toBeHidden({ timeout: 12000 })
  await page.getByTestId('workspace-architecture').click()
  const other = path.join(workspaceRoot, 'other-project')
  fs.mkdirSync(other)
  fs.writeFileSync(path.join(other, 'main.ts'), 'export const other=1')
  await electronApp.evaluate(({ dialog }, root) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] })
  }, other)
  await page.getByTestId('workspace-import-project').click()
  const selector = page.getByTestId('architecture-project')
  await selector.selectOption(fs.realpathSync(other))
  await expect(excluded).toHaveValue('')
  await selector.selectOption(fs.realpathSync(workspaceRoot))
  await expect(excluded).toHaveValue('not-scanned')
  await page.reload()
  await expect(page.getByTestId('startup-animation')).toBeHidden({ timeout: 12000 })
  await page.getByTestId('workspace-architecture').click()
  await page.getByTestId('architecture-project').selectOption(fs.realpathSync(workspaceRoot))
  await expect(excluded).toHaveValue('not-scanned')
})

test('analyzes actual source with Archify, opens references, restores snapshots and isolates projects', async ({
  page,
  electronApp,
  workspaceRoot,
  testUserData,
  piAgentDir
}, testInfo) => {
  fs.writeFileSync(
    path.join(workspaceRoot, 'index.ts'),
    "import { auth } from './auth'\nexport const app = auth\n"
  )
  fs.writeFileSync(
    path.join(workspaceRoot, 'auth.ts'),
    'export const auth = "verified-auth-module"'
  )
  await expect(page.getByTestId('startup-animation')).toBeHidden({ timeout: 12000 })
  await page.locator('a[href="#/workspace"]').click()
  await electronApp.evaluate(({ dialog }, root) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] })
  }, workspaceRoot)
  await page.getByTestId('workspace-import-project').click()
  await page.getByTestId('workspace-architecture').click()
  await expect(page.getByTestId('project-intelligence')).toContainText(path.basename(workspaceRoot))
  await page.getByTestId('analyze-project').click()
  await expect(page.getByTestId('architecture-status')).toContainText(
    /Analysis complete|分析完成/,
    { timeout: 45000 }
  )
  await expect(page.getByTestId('architecture-viewer')).toBeVisible()
  await expect
    .poll(() =>
      electronApp.evaluate(
        ({ webContents }) =>
          webContents.getAllWebContents().filter((w) => w.getURL().startsWith('pi-architecture:'))
            .length
      )
    )
    .toBe(1)
  const ids = (await electronApp.evaluate(async ({ webContents }) => {
    const view = webContents
      .getAllWebContents()
      .find((w) => w.getURL().startsWith('pi-architecture:'))!
    return view.executeJavaScript(
      `({nodes:[...new Set([...document.querySelectorAll('[data-node-id]')].map(n=>n.dataset.nodeId))],require:typeof require,pi:typeof window.piSwitch,selection:typeof window.architectureSelection?.select})`
    )
  })) as { nodes: string[]; require: string; pi: string; selection: string }
  expect(ids.nodes).toHaveLength(2)
  expect(ids.require).toBe('undefined')
  expect(ids.pi).toBe('undefined')
  expect(ids.selection).toBe('function')
  const isolated = await electronApp.evaluate(async ({ webContents }) => {
    const view = webContents
      .getAllWebContents()
      .find((w) => w.getURL().startsWith('pi-architecture:'))!
    return view.executeJavaScript(`(async()=>{
      let blocked=false;try{await fetch('https://example.invalid')}catch{blocked=true}
      return {blocked,bridge:typeof window.architectureSelection?.invoke,embedded:document.documentElement.dataset.present}
    })()`)
  })
  expect(isolated).toEqual({ blocked: true, bridge: 'undefined', embedded: 'true' })
  await electronApp.evaluate(async ({ webContents }) => {
    const view = webContents
      .getAllWebContents()
      .find((w) => w.getURL().startsWith('pi-architecture:'))!
    await view.executeJavaScript(
      `document.querySelector('[data-node-id]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`
    )
  })
  await expect(page.getByTestId('architecture-source')).toBeVisible()
  await page.getByTestId('architecture-module').filter({ hasText: 'auth.ts' }).click()
  await page.getByTestId('architecture-source').click()
  await expect(page.getByTestId('architecture-code')).toContainText('verified-auth-module')
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Close|关闭/ })
    .click()
  await page.screenshot({ path: testInfo.outputPath('architecture.png'), fullPage: true })
  const exportPath = path.join(testUserData, 'architecture.png')
  await electronApp.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, exportPath)
  await page.getByRole('button', { name: /Export view as PNG|导出当前视图 PNG/ }).click()
  await expect.poll(() => fs.existsSync(exportPath)).toBe(true)
  expect(fs.readFileSync(exportPath).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  fs.copyFileSync(exportPath, testInfo.outputPath('architecture-view.png'))
  const htmlPath = path.join(testUserData, 'architecture.html')
  await electronApp.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, htmlPath)
  await page.getByRole('button', { name: /Export HTML|导出 HTML/ }).click()
  await expect.poll(() => fs.existsSync(htmlPath)).toBe(true)
  const offline = await electronApp.evaluate(async ({ BrowserWindow }, filePath) => {
    const window = new BrowserWindow({
      show: false,
      webPreferences: {
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
        partition: 'offline-architecture-test'
      }
    })
    let networkRequests = 0
    window.webContents.session.webRequest.onBeforeRequest((request, callback) => {
      if (/^https?:/.test(request.url)) networkRequests++
      callback({ cancel: /^https?:/.test(request.url) })
    })
    try {
      await window.loadFile(filePath)
      return await window.webContents
        .executeJavaScript(
          `({nodes:[...new Set([...document.querySelectorAll('[data-node-id]')].map(n=>n.dataset.nodeId))].length,require:typeof require})`
        )
        .then((result) => ({ ...result, networkRequests }))
    } finally {
      window.destroy()
    }
  }, htmlPath)
  expect(offline).toEqual({ nodes: 2, require: 'undefined', networkRequests: 0 })
  const appWindow = await electronApp.browserWindow(page)
  const original = await appWindow.evaluate((window) => window.getBounds())
  await appWindow.evaluate((window) => window.setSize(820, 760))
  await page.getByTestId('architecture-viewer').scrollIntoViewIfNeeded()
  await expect
    .poll(async () => {
      const clip = await page.locator('.architecture-layout').boundingBox()
      const bounds = await appWindow.evaluate((window) => {
        const view = window.contentView.children.find((child) => 'webContents' in child)
        return view?.getBounds()
      })
      return Boolean(
        clip &&
        bounds &&
        bounds.width > 0 &&
        bounds.height > 0 &&
        bounds.x >= clip.x - 1 &&
        bounds.y >= clip.y - 1 &&
        bounds.x + bounds.width <= clip.x + clip.width + 1 &&
        bounds.y + bounds.height <= clip.y + clip.height + 1
      )
    })
    .toBe(true)
  await appWindow.evaluate((window, size) => window.setSize(size.width, size.height), original)
  await page.locator('.architecture-layout').evaluate((element) => {
    element.scrollTop = 0
  })
  const first = await page.evaluate(
    (root) => window.piSwitch!.intelligence.snapshot({ root }),
    workspaceRoot
  )
  expect(first?.graph.edges).toHaveLength(1)
  const importer = first!.graph.nodes.find((node) => node.name === 'index.ts')!
  const context = await page.evaluate(
    ({ root, moduleId }) =>
      window.piSwitch!.intelligence.query(root, { moduleId, direction: 'downstream' }),
    { root: workspaceRoot, moduleId: importer.id }
  )
  expect(context).toMatchObject({
    available: true,
    tool: 'get_module_details',
    pagination: 'relationships',
    snapshotId: first!.graph.snapshotId,
    relationships: first!.graph.edges,
    total: 1,
    nextOffset: null
  })
  // Restore the persisted project and snapshot across Renderer restart.
  await page.reload()
  await expect(page.getByTestId('startup-animation')).toBeHidden({ timeout: 12000 })
  await page.getByTestId('workspace-architecture').click()
  await expect(page.getByTestId('architecture-module')).toHaveCount(2)
  const denied = await page.evaluate(async (root) => {
    try {
      await window.piSwitch!.intelligence.analyze({ root })
      return false
    } catch {
      return true
    }
  }, testUserData)
  expect(denied).toBe(true)
  const bad = await page.evaluate(
    async ({ root, snapshotId, moduleId }) => {
      try {
        await window.piSwitch!.intelligence.source(root, snapshotId, moduleId, '../outside')
        return false
      } catch {
        return true
      }
    },
    { root: workspaceRoot, snapshotId: first!.graph.snapshotId, moduleId: first!.graph.nodes[0].id }
  )
  expect(bad).toBe(true)
  fs.writeFileSync(path.join(workspaceRoot, 'auth.ts'), 'export const auth = "updated"')
  await expect
    .poll(async () =>
      page.evaluate(
        async (root) => (await window.piSwitch!.intelligence.snapshot({ root }))?.staleness,
        workspaceRoot
      )
    )
    .toBe('stale')
  const otherRoot = path.join(workspaceRoot, 'other', path.basename(workspaceRoot))
  fs.mkdirSync(otherRoot, { recursive: true })
  fs.writeFileSync(path.join(otherRoot, 'other.ts'), 'export const otherProject = true')
  await electronApp.evaluate(({ dialog }, root) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] })
  }, otherRoot)
  await page.getByTestId('workspace-import-project').click()
  const projects = page.getByTestId('architecture-project')
  await projects.selectOption(fs.realpathSync(otherRoot))
  await expect(page.getByTestId('architecture-module')).toHaveCount(0)
  await page.getByTestId('analyze-project').click()
  await expect(page.getByTestId('architecture-status')).toContainText(/complete|完成/, {
    timeout: 45000
  })
  await expect(page.getByTestId('architecture-module')).toHaveText('other.ts')
  const other = await page.evaluate(
    (root) => window.piSwitch!.intelligence.snapshot({ root }),
    otherRoot
  )
  expect(other!.graph.workspaceId).not.toBe(first!.graph.workspaceId)
  await projects.selectOption(fs.realpathSync(workspaceRoot))
  await expect(page.getByTestId('architecture-module')).toHaveCount(2)
  const executablePath = await electronApp.evaluate(() => process.execPath)
  await electronApp.close()
  const restarted = await electron.launch({
    executablePath,
    args: [path.resolve('out/main/index.js')],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: undefined,
      PI_HARNESS_PI_CLI_PATH: path.join(testUserData, 'missing-pi-cli'),
      PI_HARNESS_PI_CONFIG_DIR: piAgentDir,
      PI_CODING_AGENT_DIR: piAgentDir,
      PI_HARNESS_USER_DATA: testUserData,
      PI_HARNESS_SESSION_HOME: path.join(testUserData, 'history-home'),
      PI_HARNESS_BUILTIN_SKILLS_DIR: path.resolve('resources/builtin-skills'),
      PI_HARNESS_CAPABILITY_FIXTURES_DIR: path.resolve('fixtures/capabilities')
    }
  })
  try {
    const restored = await restarted.firstWindow()
    await expect(restored.getByTestId('startup-animation')).toBeHidden({ timeout: 12000 })
    await restored.locator('a[href="#/workspace"]').click()
    await restored.getByTestId('workspace-architecture').click()
    await restored.getByTestId('architecture-project').selectOption(fs.realpathSync(workspaceRoot))
    await expect(restored.getByTestId('architecture-module')).toHaveCount(2)
  } finally {
    await restarted.close()
  }
})

test('cancels a configured Pi model request without replacing the successful snapshot', async ({
  page,
  electronApp,
  workspaceRoot
}) => {
  let requests = 0
  let respond = true
  const server = http.createServer((request, response) => {
    requests++
    let body = ''
    request.on('data', (chunk) => {
      body += chunk.toString()
    })
    request.on('end', () => {
      if (!respond) return // Hold the second actual SDK call until the user cancels.
      const input = JSON.parse(body)
      const sample = JSON.parse(
        input.messages.find((message: { role: string }) => message.role === 'user').content
      ).modules[0]
      const content = JSON.stringify({
        summary: 'Source-backed app summary',
        modules: [{ id: sample.id, description: 'Exports the app value' }]
      })
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.write(
        `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 0, model: 'architecture-test', choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] })}\n\n`
      )
      response.end(
        `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 0, model: 'architecture-test', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 } })}\n\ndata: [DONE]\n\n`
      )
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  try {
    fs.writeFileSync(path.join(workspaceRoot, 'app.ts'), 'export const app = true')
    await page.locator('a[href="#/workspace"]').click()
    await electronApp.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] })
    }, workspaceRoot)
    await page.getByTestId('workspace-import-project').click()
    await page.getByTestId('workspace-architecture').click()
    await page.getByTestId('analyze-project').click()
    await expect(page.getByTestId('architecture-status')).toContainText(/complete|完成/, {
      timeout: 45000
    })
    const before = await page.evaluate(
      (root) => window.piSwitch!.intelligence.snapshot({ root }),
      workspaceRoot
    )
    await page.evaluate(async (baseUrl) => {
      const policy = await window.piSwitch!.harness.getPolicy()
      await window.piSwitch!.harness.setPolicy({ ...policy.config, network: 'allow' })
      await window.piSwitch!.config.writeRaw(
        'models',
        JSON.stringify({
          providers: {
            'local-test': {
              api: 'openai-completions',
              baseUrl,
              apiKey: 'mock-local-only',
              models: [
                { id: 'architecture-test', name: 'Local test', reasoning: false, input: ['text'] }
              ]
            }
          }
        })
      )
      await window.piSwitch!.config.writeRaw(
        'settings',
        JSON.stringify({ defaultProvider: 'local-test', defaultModel: 'architecture-test' })
      )
    }, `http://127.0.0.1:${port}/v1`)
    await page.getByTestId('architecture-analysis-options-toggle').click()
    await page.getByRole('switch', { name: /Use configured model|使用已配置模型/ }).click()
    await page.getByTestId('analyze-project').click()
    await expect.poll(() => requests, { timeout: 20000 }).toBe(1)
    await expect(page.getByTestId('architecture-status')).toContainText(/complete|完成/, {
      timeout: 45000
    })
    const enriched = await page.evaluate(
      (root) => window.piSwitch!.intelligence.snapshot({ root }),
      workspaceRoot
    )
    expect(enriched!.graph.summary).toBe('Source-backed app summary')
    expect(enriched!.graph.nodes[0].description).toBe('Exports the app value')
    expect(enriched!.graph.nodes[0].evidence).toBe('ai-inferred')
    expect(enriched!.graph.revision.modelId).toBe('local-test/architecture-test')
    expect(enriched!.graph.snapshotId).not.toBe(before!.graph.snapshotId)
    respond = false
    await page.getByTestId('analyze-project').click()
    await expect.poll(() => requests, { timeout: 20000 }).toBe(2)
    await page.getByRole('button', { name: /Cancel Analysis|取消分析/ }).click()
    await expect(page.getByTestId('architecture-status')).toContainText(/cancelled|已取消/, {
      timeout: 10000
    })
    const after = await page.evaluate(
      (root) => window.piSwitch!.intelligence.snapshot({ root }),
      workspaceRoot
    )
    expect(after!.graph.snapshotId).toBe(enriched!.graph.snapshotId)
    await expect(page.getByTestId('architecture-module')).toHaveText('app.ts')
    const tools = await page.evaluate(async (root) => {
      const session = await window.piSwitch!.agent.start({
        cwd: root,
        provider: 'local-test',
        modelId: 'architecture-test'
      })
      return (await window.piSwitch!.harness.tools(session.sessionId)).map((tool) => tool.name)
    }, workspaceRoot)
    expect(tools).toEqual(
      expect.arrayContaining([
        'get_project_architecture',
        'search_project_modules',
        'get_module_details',
        'get_module_sources',
        'get_related_modules'
      ])
    )
    expect(requests).toBe(2) // Starting a Native Pi session does not itself call the model.
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  }
})

test('scan errors are retryable and an unavailable model preserves the local index', async ({
  page,
  electronApp,
  workspaceRoot
}) => {
  await expect(page.getByTestId('startup-animation')).toBeHidden({ timeout: 12000 })
  await page.locator('a[href="#/workspace"]').click()
  await electronApp.evaluate(({ dialog }, root) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] })
  }, workspaceRoot)
  await page.getByTestId('workspace-import-project').click()
  await page.getByTestId('workspace-architecture').click()
  await expect(page.getByTestId('project-intelligence')).toContainText(path.basename(workspaceRoot))
  await page.getByTestId('analyze-project').click()
  await expect(page.getByTestId('architecture-status')).toContainText(/failed|失败/, {
    timeout: 10000
  })
  fs.writeFileSync(path.join(workspaceRoot, 'main.py'), 'print("real source")')
  await page.evaluate(async () => {
    await window.piSwitch!.config.writeRaw('settings', '{}')
    await window.piSwitch!.config.writeRaw('models', '{"providers":{}}')
  })
  await page.getByTestId('architecture-analysis-options-toggle').click()
  await page.getByRole('switch', { name: /Use configured model|使用已配置模型/ }).click()
  await expect(page.getByTestId('project-intelligence')).toContainText(path.basename(workspaceRoot))
  await page.getByTestId('analyze-project').click()
  await expect(page.getByTestId('architecture-status')).toContainText(/complete|完成/, {
    timeout: 45000
  })
  const graph = await page.evaluate(
    async (root) => (await window.piSwitch!.intelligence.snapshot({ root }))!.graph,
    workspaceRoot
  )
  expect(graph.revision.modelId).toBeNull()
  expect(graph.nodes[0].name).toBe('main.py')
  expect(graph.warnings.join(' ')).toContain('AI analysis')
})

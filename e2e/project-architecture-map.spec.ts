import fs from 'node:fs'
import path from 'node:path'
import { test, expect } from './fixtures'
import { clickArchitectureControl, expectArchitectureDockToFit } from './architecture-controls'

const projects = [
  path.resolve('.'),
  ...(process.env.PI_HARNESS_ARCHIFY_TEST_ROOT ? [process.env.PI_HARNESS_ARCHIFY_TEST_ROOT] : [])
]
for (const project of projects) {
  test(`renders an interactive architecture map for ${path.basename(project)} and repairs old failed artifacts`, async ({
    page,
    electronApp,
    testUserData
  }, testInfo) => {
    test.setTimeout(150000)
    const root = fs.realpathSync(project)
    await page.locator('a[href="#/workspace"]').click()
    await electronApp.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] })
    }, root)
    await page.getByTestId('workspace-import-project').click()
    await page.getByTestId('workspace-architecture').click()
    await page.getByTestId('analyze-project').click()
    await expect(page.getByTestId('architecture-status')).toContainText(
      /Analysis complete|分析完成/,
      { timeout: 45000 }
    )
    await expect(page.getByTestId('architecture-viewer')).toBeVisible()
    const snapshot = await page.evaluate(
      (root) => window.piSwitch!.intelligence.snapshot({ root }),
      root
    )
    expect(snapshot!.viewerUrl).toBeTruthy()
    expect(snapshot!.graph.nodes.length).toBeGreaterThan(48)
    await expect(page.getByTestId('architecture-module-details')).toHaveCount(0)
    await expect(page.getByTestId('architecture-analysis-options-toggle')).toHaveAttribute(
      'aria-expanded',
      'false'
    )
    await expect(page.getByTestId('architecture-summary')).not.toHaveAttribute('open', '')
    const panelBox = (await page.getByTestId('project-intelligence').boundingBox())!
    const canvasBox = (await page.getByTestId('architecture-viewer').boundingBox())!
    const layoutBox = (await page.locator('.architecture-layout').boundingBox())!
    expect(canvasBox.height).toBeGreaterThan(panelBox.height * 0.65)
    expect(canvasBox.width).toBeGreaterThan(layoutBox.width * 0.65)
    expect(
      (await page.getByTestId('architecture-module-browser').boundingBox())!.width
    ).toBeLessThanOrEqual(190)
    await page.getByTestId('architecture-toggle-modules').click()
    await expect(page.getByTestId('architecture-module-browser')).toBeHidden()
    expect((await page.getByTestId('architecture-viewer').boundingBox())!.width).toBeGreaterThan(
      canvasBox.width
    )
    await page.getByTestId('architecture-toggle-modules').click()

    const nativeNodeCount = () =>
      electronApp.evaluate(async ({ webContents }) => {
        const view = webContents
          .getAllWebContents()
          .find((view) => view.getURL().startsWith('pi-architecture:'))!
        if (!view) return 0
        return view.executeJavaScript(
          '[...new Set([...document.querySelectorAll("[data-node-id]")].map(node=>node.dataset.nodeId))].length'
        )
      })
    await expect.poll(nativeNodeCount).toBe(48)
    const pinch = await electronApp.evaluate(async ({ webContents }) => {
      const view = webContents
        .getAllWebContents()
        .find((view) => view.getURL().startsWith('pi-architecture:'))!
      const attached = view.debugger.isAttached()
      if (!attached) view.debugger.attach('1.3')
      try {
        const before = await view.executeJavaScript('Archify.view.state().scale')
        await view.debugger.sendCommand('Input.dispatchMouseEvent', {
          type: 'mouseWheel',
          x: 240,
          y: 180,
          deltaX: 0,
          deltaY: -30,
          modifiers: 2
        })
        const enlarged = await view.executeJavaScript('Archify.view.state().scale')
        await view.debugger.sendCommand('Input.dispatchMouseEvent', {
          type: 'mouseWheel',
          x: 240,
          y: 180,
          deltaX: 0,
          deltaY: 30,
          modifiers: 2
        })
        const reduced = await view.executeJavaScript('Archify.view.state().scale')
        return { before, enlarged, reduced, pageZoom: view.zoomFactor }
      } finally {
        if (!attached) view.debugger.detach()
      }
    })
    expect(pinch.enlarged).toBeGreaterThan(pinch.before)
    expect(pinch.reduced).toBeLessThan(pinch.enlarged)
    expect(pinch.pageZoom).toBe(1)
    await expect(page.getByTestId('architecture-fullscreen')).toHaveCount(0)
    await expect(page.getByTestId('architecture-map-pages')).toHaveCount(0)
    const fullscreen = () => clickArchitectureControl(electronApp, 'fullscreen')
    const nativeWindow = await electronApp.browserWindow(page)
    const originalBounds = await nativeWindow.evaluate((window) => window.getBounds())
    const isNativeFullscreen = () =>
      nativeWindow.evaluate(
        (window) =>
          window.isFullScreen() || (process.platform === 'darwin' && window.isSimpleFullScreen())
      )
    await fullscreen()
    await expect
      .poll(() => page.evaluate(() => document.fullscreenElement?.id))
      .toBe('pi-architecture-panel')
    await expect.poll(isNativeFullscreen).toBe(true)
    await expect(page.getByTestId('architecture-module-browser')).toBeHidden()
    await expectArchitectureDockToFit(electronApp)
    await electronApp.evaluate(async ({ webContents }) => {
      const view = webContents
        .getAllWebContents()
        .find((view) => view.getURL().startsWith('pi-architecture:'))!
      await view.executeJavaScript(`(()=>{
        const route=document.getElementById('btn-route-probe');route.click();route.focus();
        for(let step=0;step<8;step++)Archify.view.zoomIn();
      })()`)
    })
    await expectArchitectureDockToFit(electronApp)
    const fullscreenPng = await electronApp.evaluate(async ({ webContents }) => {
      const view = webContents
        .getAllWebContents()
        .find((view) => view.getURL().startsWith('pi-architecture:'))!
      const screenshot = await view.capturePage()
      return screenshot.toPNG().toString('base64')
    })
    fs.writeFileSync(
      testInfo.outputPath('fullscreen-dock.png'),
      Buffer.from(fullscreenPng, 'base64')
    )
    await electronApp.evaluate(async ({ webContents }) => {
      const view = webContents
        .getAllWebContents()
        .find((view) => view.getURL().startsWith('pi-architecture:'))!
      await view.executeJavaScript(
        "document.getElementById('btn-route-probe').click();Archify.view.reset()"
      )
    })
    await electronApp.evaluate(({ webContents }) => {
      const view = webContents
        .getAllWebContents()
        .find((view) => view.getURL().startsWith('pi-architecture:'))!
      view.focus()
      view.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
      view.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
    })
    await expect.poll(() => page.evaluate(() => document.fullscreenElement?.id ?? null)).toBeNull()
    await expect.poll(isNativeFullscreen).toBe(false)
    await expect
      .poll(() => nativeWindow.evaluate((window) => window.getBounds()))
      .toEqual(originalBounds)
    await expect(page.getByTestId('architecture-module-browser')).toBeVisible()
    await fullscreen()
    await expect
      .poll(() => page.evaluate(() => document.fullscreenElement?.id))
      .toBe('pi-architecture-panel')
    await fullscreen()
    await expect.poll(() => page.evaluate(() => document.fullscreenElement?.id ?? null)).toBeNull()
    await expect.poll(isNativeFullscreen).toBe(false)
    // Exiting the diagram must retain a window that was already full screen.
    if (process.platform === 'darwin') {
      await nativeWindow.evaluate((window) => window.setSimpleFullScreen(true))
      await fullscreen()
      await expect
        .poll(() => page.evaluate(() => document.fullscreenElement?.id))
        .toBe('pi-architecture-panel')
      await fullscreen()
      await expect
        .poll(() => page.evaluate(() => document.fullscreenElement?.id ?? null))
        .toBeNull()
      await expect.poll(isNativeFullscreen).toBe(true)
      await nativeWindow.evaluate((window) => window.setSimpleFullScreen(false))
    }
    const interactive = await electronApp.evaluate(async ({ webContents }) => {
      const view = webContents
        .getAllWebContents()
        .find((view) => view.getURL().startsWith('pi-architecture:'))!
      return view.executeJavaScript(`(() => {
        const before = Archify.view.state().scale;
        document.querySelector('button[data-view="in"]').click();
        const after = Archify.view.state().scale;
        document.querySelector('[data-node-id]').dispatchEvent(new MouseEvent('click', {bubbles:true}));
        return {before, after, overflow:[...document.querySelectorAll('[data-node-label]')].filter(label => label.getBBox().width > label.parentElement.querySelector('rect').getBBox().width).length};
      })()`)
    })
    expect(interactive.after).toBeGreaterThan(interactive.before)
    expect(interactive.overflow).toBe(0)
    await expect(page.getByTestId('architecture-source')).toBeVisible()
    await page.getByTestId('architecture-source').click()
    await expect(page.getByTestId('architecture-code')).toBeVisible()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /Close|关闭/ })
      .click()
    await page.getByTestId('architecture-close-details').click()
    await expect(page.getByTestId('architecture-module-details')).toHaveCount(0)
    await clickArchitectureControl(electronApp, 'next')
    await expect.poll(nativeNodeCount).toBe(Math.min(48, snapshot!.graph.nodes.length - 48))
    const longName =
      snapshot!.graph.nodes.find((node) =>
        node.name.endsWith('components/chat/ToolCallView.vue')
      ) ??
      snapshot!.graph.nodes.find((node) =>
        node.name.endsWith('renderers/architecture/render-architecture.mjs')
      ) ??
      snapshot!.graph.nodes.find((node) => node.name.length > 44)!
    await page.getByTestId('architecture-module').filter({ hasText: longName.name }).click()
    await page.getByTestId('architecture-focus').click()
    await expect(page.getByTestId('architecture-focus')).toBeEnabled()
    await expect
      .poll(async () => {
        const current = await page.evaluate(
          (root) => window.piSwitch!.intelligence.snapshot({ root }),
          root
        )
        return current!.graph.snapshotId
      })
      .toBe(snapshot!.graph.snapshotId)
    await electronApp.evaluate(async ({ webContents }) => {
      const view = webContents
        .getAllWebContents()
        .find((view) => view.getURL().startsWith('pi-architecture:'))!
      await view.executeJavaScript("document.getElementById('btn-focus-clear').click()")
    })
    // A focused map inside a narrow viewport must keep the desktop pinch camera.
    await page.setViewportSize({ width: 920, height: 740 })
    await electronApp.evaluate(async ({ webContents }) => {
      const view = webContents
        .getAllWebContents()
        .find((view) => view.getURL().startsWith('pi-architecture:'))!
      await view.executeJavaScript('Archify.view.reset()')
    })
    await expect
      .poll(() =>
        electronApp.evaluate(async ({ webContents }) => {
          const view = webContents
            .getAllWebContents()
            .find((view) => view.getURL().startsWith('pi-architecture:'))!
          return view.executeJavaScript(
            'new DOMMatrixReadOnly(getComputedStyle(document.querySelector(".diagram-container>svg")).transform).a'
          )
        })
      )
      .toBeCloseTo(1)
    const focusedPinch = await electronApp.evaluate(async ({ webContents }) => {
      const view = webContents
        .getAllWebContents()
        .find((view) => view.getURL().startsWith('pi-architecture:'))!
      return view.executeJavaScript(`new Promise(resolve => requestAnimationFrame(() => {
        const container = document.querySelector('.diagram-container');
        container.setAttribute('data-wide-diagram', 'true');
        container.dispatchEvent(new WheelEvent('wheel', {deltaY:-25,ctrlKey:true,clientX:180,clientY:160,cancelable:true}));
        const enlarged = Archify.view.state().scale;
        container.dispatchEvent(new WheelEvent('wheel', {deltaY:25,ctrlKey:true,clientX:180,clientY:160,cancelable:true}));
        resolve({width:innerWidth,enlarged,reduced:Archify.view.state().scale});
      }))`)
    })
    expect(focusedPinch.width).toBeLessThanOrEqual(720)
    expect(focusedPinch.enlarged).toBeGreaterThan(1)
    expect(focusedPinch.reduced).toBeCloseTo(1)
    await page.setViewportSize({ width: originalBounds.width, height: originalBounds.height })
    const pngPath = path.join(testUserData, 'interactive-map.png')
    await electronApp.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath })
    }, pngPath)
    await page.getByRole('button', { name: /Export view as PNG|导出当前视图 PNG/ }).click()
    await expect.poll(() => fs.existsSync(pngPath)).toBe(true)
    fs.copyFileSync(pngPath, testInfo.outputPath('interactive-map.png'))

    // Simulate a valid saved index from the earlier build whose CLI render failed.
    const recordPath = path.join(
      testUserData,
      'project-intelligence',
      snapshot!.graph.workspaceId,
      `${snapshot!.graph.snapshotId}.json`
    )
    const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'))
    record.html = null
    fs.writeFileSync(recordPath, JSON.stringify(record))
    await page.reload()
    await expect(page.getByTestId('startup-animation')).toBeHidden({ timeout: 12000 })
    await page.getByTestId('workspace-architecture').click()
    await expect(page.getByTestId('architecture-retry-map')).toBeVisible()
    await page.getByTestId('architecture-retry-map').click()
    await expect(page.getByTestId('architecture-viewer')).toBeVisible()
    await expect.poll(nativeNodeCount).toBe(48)
    expect(JSON.parse(fs.readFileSync(recordPath, 'utf8')).html).toContain('data-node-id=')
    const recovered = await page.evaluate(
      (root) => window.piSwitch!.intelligence.snapshot({ root }),
      root
    )
    expect(recovered!.graph).toEqual(snapshot!.graph)
    await page.reload()
    await expect(page.getByTestId('startup-animation')).toBeHidden({ timeout: 12000 })
    await page.getByTestId('workspace-architecture').click()
    await expect(page.getByTestId('architecture-viewer')).toBeVisible()
    await expect(page.getByTestId('architecture-retry-map')).toHaveCount(0)
  })
}

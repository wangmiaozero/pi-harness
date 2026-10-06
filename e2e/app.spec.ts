import { test, expect } from './fixtures'

test.describe('Application shell', () => {
  test('operates the leading window controls', async ({ page, electronApp }) => {
    test.skip(process.platform === 'win32', 'Windows uses trailing window controls')
    const controls = page.getByTestId('titlebar-window-controls')
    await expect(controls).toBeVisible()
    // Transformed no-drag regions can miss native hit testing on macOS.
    await expect(controls).toHaveCSS('transform', 'none')
    const dragArea = page.getByTestId('titlebar-drag-area')
    await expect(dragArea).toHaveCSS('-webkit-app-region', 'drag')
    await expect(page.locator('header.app-titlebar')).toHaveCSS('-webkit-app-region', 'no-drag')
    const controlBounds = (await controls.boundingBox())!
    const dragBounds = (await dragArea.boundingBox())!
    expect(dragBounds.x).toBeGreaterThan(controlBounds.x + controlBounds.width)
    for (const action of ['close', 'minimize', 'maximize']) {
      await expect(page.getByTestId(`titlebar-window-${action}`)).toHaveCSS(
        '-webkit-app-region',
        'no-drag'
      )
    }
    await page.getByTestId('titlebar-window-maximize').click()
    await expect
      .poll(() =>
        electronApp.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()
            .find((win) => !win.webContents.getURL().includes('overlay.html'))
            ?.isMaximized()
        )
      )
      .toBe(true)
    await page.getByTestId('titlebar-window-maximize').click()
    await expect
      .poll(() =>
        electronApp.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()
            .find((win) => !win.webContents.getURL().includes('overlay.html'))
            ?.isMaximized()
        )
      )
      .toBe(false)
    await page.getByTestId('titlebar-window-minimize').click()
    await expect
      .poll(() =>
        electronApp.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()
            .find((win) => !win.webContents.getURL().includes('overlay.html'))
            ?.isMinimized()
        )
      )
      .toBe(true)
    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(
        (win) => !win.webContents.getURL().includes('overlay.html')
      )!
      win.restore()
      win.on('close', (event) => {
        event.preventDefault()
        win.setTitle('close-control-invoked')
      })
    })
    await page.getByTestId('titlebar-window-close').click()
    await expect
      .poll(() =>
        electronApp.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()
            .find((win) => !win.webContents.getURL().includes('overlay.html'))
            ?.getTitle()
        )
      )
      .toBe('close-control-invoked')
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((win) => !win.webContents.getURL().includes('overlay.html'))
        ?.removeAllListeners('close')
    })
  })

  test('shows the particle startup animation on each window load', async ({ page }) => {
    await page.reload()
    await expect(page.getByTestId('startup-animation')).toBeVisible()
    await expect(page.getByTestId('startup-animation')).toContainText('检测')
    await expect(page.getByTestId('startup-check-network')).toContainText(
      /已连接|连接失败|检测失败/
    )
    await expect(page.getByTestId('startup-check-node')).toContainText(
      /已就绪|未检测到|版本过低|检测失败/
    )
    await expect(page.getByTestId('startup-check-npm')).toContainText(/已就绪|未检测到|检测失败/)
    await expect(page.getByTestId('startup-animation')).toBeHidden({ timeout: 12_000 })
  })

  test('keeps the command palette open until its close button is used', async ({ page }) => {
    await expect(page.getByText('Pi-Harness').first()).toBeVisible({ timeout: 30_000 })
    await page.keyboard.press('Meta+K')

    const palette = page.getByRole('dialog', { name: /命令面板|Command Palette/ })
    await expect(palette).toBeVisible()
    await page.mouse.click(5, 5)
    await expect(palette).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(palette).toBeVisible()
    await palette.getByRole('button', { name: /关闭|Close/ }).click()
    await expect(palette).toBeHidden()
  })

  test('uses a distinct startup quantum variant for each unlocked theme', async ({
    page
  }, testInfo) => {
    await page.evaluate(() => window.piSwitch.settings.unlockMascot('1024'))
    for (const style of [
      'maidWhite',
      'office',
      'starshipCockpit',
      'noirScholar',
      'moonlitMaid',
      'mingSnow',
      'mingMoon'
    ] as const) {
      await page.evaluate((mascotStyle) => window.piSwitch.settings.set({ mascotStyle }), style)
      await page.reload()
      await expect(page.getByTestId('startup-animation')).toHaveAttribute(
        'data-startup-variant',
        style
      )
      await expect(page.getByTestId('startup-animation')).toHaveCSS('background-color', /rgb\(/)
      await page.screenshot({ path: testInfo.outputPath(`startup-${style}.png`) })
    }

    await page.evaluate(() => window.piSwitch.settings.set({ mascotStyle: 'none' }))
    await page.reload()
    await expect(page.getByTestId('startup-animation')).toHaveAttribute(
      'data-startup-variant',
      'none'
    )
  })
})

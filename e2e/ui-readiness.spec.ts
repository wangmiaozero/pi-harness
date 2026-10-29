import { test, expect } from './fixtures'

// Electron page zoom checks CSS layouts; it does not emulate physical monitor DPI.
test('keeps model controls and dialog keyboard focus usable across zoom and viewport sizes', async ({
  page,
  electronApp
}, testInfo) => {
  test.setTimeout(180000)
  await page.locator('a[href="#/workspace"]').click()
  await expect(page.getByTestId('workspace-main')).toBeVisible()
  for (const size of [
    { width: 1280, height: 900 },
    { width: 1000, height: 700 },
    { width: 960, height: 640 },
    { width: 800, height: 600 }
  ]) {
    await page.setViewportSize(size)
    for (const zoom of [1, 1.25, 1.5, 2]) {
      await electronApp.evaluate(
        ({ BrowserWindow }, zoom) =>
          BrowserWindow.getAllWindows()
            .find((window) => window.webContents.getURL().includes('index.html'))!
            .webContents.setZoomFactor(zoom),
        zoom
      )
      const trigger = page.getByTestId('workspace-model-select').getByRole('button')
      await trigger.focus()
      await trigger.press('Enter')
      const panel = page.getByTestId('composer-model-panel')
      await expect(panel).toBeVisible()
      const geometry = await panel.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return {
          x: rect.x,
          y: rect.y,
          right: rect.right,
          bottom: rect.bottom,
          width: innerWidth,
          height: innerHeight,
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth
        }
      })
      expect(geometry.x).toBeGreaterThanOrEqual(-1)
      expect(geometry.y).toBeGreaterThanOrEqual(-1)
      expect(geometry.right).toBeLessThanOrEqual(geometry.width + 1)
      expect(geometry.bottom).toBeLessThanOrEqual(geometry.height + 1)
      expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1)
      const slider = page.getByTestId('composer-thinking-slider')
      await slider.focus()
      await slider.press('End')
      await expect(slider).toHaveAttribute('aria-label', /.+/)
      await page.keyboard.press('Tab')
      await page.keyboard.press('Escape')
      await expect(panel).toHaveCount(0)
      await expect(trigger).toBeFocused()
    }
  }
  await electronApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((window) => window.webContents.getURL().includes('index.html'))!
      .webContents.setZoomFactor(1)
  )
  await page.setViewportSize({ width: 1000, height: 700 })
  await page.locator('a[href="#/models"]').click()
  await page.getByTestId('model-management-tab-providers').click()
  await page
    .getByTestId('provider-action-cell')
    .first()
    .getByRole('button', { name: /^(测试|Test)$/ })
    .click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toHaveAttribute('aria-labelledby', /.+/)
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Tab')
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('keyboard-and-zoom.png') })
})

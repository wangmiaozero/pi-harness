import { test, expect } from './fixtures'

test('loads the isolated Main/preload/renderer boundary and records the actual runtime platform', async ({
  page,
  electronApp
}) => {
  const runtime = await electronApp.evaluate(({ app, BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(
      (window) => !window.webContents.getURL().includes('overlay.html')
    )!
    const preferences = window.webContents.getLastWebPreferences()
    return {
      platform: process.platform,
      arch: process.arch,
      packaged: app.isPackaged,
      isolation: preferences.contextIsolation,
      nodeIntegration: preferences.nodeIntegration
    }
  })
  expect(runtime.isolation).toBe(true)
  expect(runtime.nodeIntegration).toBe(false)
  expect(runtime.arch).toBe(process.env.PI_HARNESS_EXPECTED_ARCH ?? process.arch)
  expect(runtime.platform).toBe(process.env.PI_HARNESS_EXPECTED_PLATFORM ?? process.platform)
  if (process.env.PI_HARNESS_E2E_EXECUTABLE) expect(runtime.packaged).toBe(true)
  const boundary = await page.evaluate(async () => ({
    settings: await window.piSwitch.settings.get(),
    sessions: await window.piSwitch.sessions.list(),
    requireType: typeof (window as Window & { require?: unknown }).require
  }))
  expect(boundary.requireType).toBe('undefined')
  expect(boundary.sessions).toEqual([])
  expect(boundary.settings).toBeTruthy()
  await page.locator('a[href="#/workspace"]').click()
  await expect(page.getByTestId('composer-editor')).toBeVisible()
})

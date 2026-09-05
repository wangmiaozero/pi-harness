import path from 'node:path'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { test, expect } from './fixtures'
import { IPC_INVOKE } from '../src/shared/ipc/channels'

const { version: APP_VERSION } = JSON.parse(readFileSync('package.json', 'utf8')) as {
  version: string
}
const nextVersion = `${Number(APP_VERSION.split('.')[0]) + 1}.0.0`
const releasePage = 'https://github.com/wangmiaozero/pi-harness/releases/latest'
const updaterModuleUrl = pathToFileURL(
  path.resolve('node_modules/electron-updater/out/main.js')
).href

test('development builds check the public release API from the always-available updates page', async ({
  electronApp,
  page
}) => {
  // Development builds have no app-update.yml; the check compares against the
  // public GitHub Release instead. Mock it so the assertion is deterministic.
  await electronApp.evaluate(({ app, net }, version) => {
    Object.defineProperty(app, 'isPackaged', { value: false })
    net.fetch = async () =>
      new Response(JSON.stringify({ tag_name: `v${version}`, draft: false, prerelease: false }))
  }, APP_VERSION)

  const result = await page.evaluate(() => window.piSwitch.updater.check())
  expect(result).toMatchObject({ supported: true, status: 'not-available', available: false })

  await page.locator('a[href="#/settings"]').click()
  await page.getByTestId('settings-section-updates').click()
  await expect(page.getByRole('button', { name: /检查更新|Check for updates/ }).first()).toBeVisible()
  await expect(page.getByTestId('settings-version')).toContainText(APP_VERSION)
})

test('loads the real ESM updater and offers the manual release download', async ({
  electronApp,
  page
}) => {
  // Use the real compiled Main/Preload and native module loader. The development
  // Electron bundle has no app-update.yml, matching an incomplete manual release.
  await electronApp.evaluate(({ app, net, shell }, version) => {
    Object.defineProperty(app, 'isPackaged', { value: true })
    net.fetch = async () =>
      new Response(JSON.stringify({ tag_name: `v${version}`, draft: false, prerelease: false }))
    shell.openExternal = async (url) => {
      ;(globalThis as unknown as { openedReleasePage: string }).openedReleasePage = url
    }
  }, nextVersion)

  await page.evaluate(() => {
    window.location.hash = '/settings/updates'
  })
  await page.getByRole('button', { name: /检查更新|Check for updates/ }).click()
  await expect(
    page
      .getByText(new RegExp(`发现新版本 ${nextVersion}|Update ${nextVersion} is available`))
      .first()
  ).toBeVisible()
  expect(await page.evaluate(() => window.piSwitch.updater.state())).toMatchObject({
    status: 'manual-update',
    available: true,
    latestVersion: nextVersion,
    downloaded: false
  })

  const listenerCount = await electronApp.evaluate((_electron, moduleUrl) => {
    // Inspect the same CJS singleton loaded by the application's native import;
    // Playwright's evaluation context itself cannot run dynamic imports.
    const require = process.getBuiltinModule('module').createRequire(moduleUrl)
    return require('electron-updater').autoUpdater.listenerCount('update-available')
  }, updaterModuleUrl)
  expect(listenerCount).toBe(1)

  await page.getByRole('button', { name: /前往下载|Go to downloads/ }).click()
  await expect
    .poll(() =>
      electronApp.evaluate(
        () => (globalThis as unknown as { openedReleasePage: string }).openedReleasePage
      )
    )
    .toBe(releasePage)
  await expect(page.getByRole('button', { name: /安装并重启|Install & Restart/ })).toHaveCount(0)

  // Test the actual registered IPC boundary, including rejection of extra URLs.
  const rejected = await electronApp.evaluate(({ ipcMain, BrowserWindow }, channel) => {
    const handlers = (
      ipcMain as unknown as {
        _invokeHandlers: Map<string, (event: unknown, ...args: unknown[]) => unknown>
      }
    )._invokeHandlers
    const contents = BrowserWindow.getAllWindows().find(
      (window) => !window.webContents.getURL().includes('overlay.html')
    )!.webContents
    return handlers.get(channel)!(
      {
        sender: contents,
        senderFrame: contents.mainFrame
      },
      'https://example.com/untrusted'
    )
  }, IPC_INVOKE.updaterOpenReleasePage)
  expect(rejected).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } })
})

test('confirms the current version when automatic-update metadata is missing', async ({
  electronApp,
  page
}) => {
  await electronApp.evaluate(({ app, net }, version) => {
    Object.defineProperty(app, 'isPackaged', { value: true })
    net.fetch = async () => new Response(JSON.stringify({ tag_name: `v${version}` }))
  }, APP_VERSION)
  await page.evaluate(() => {
    window.location.hash = '/settings/updates'
  })
  await page.getByRole('button', { name: /检查更新|Check for updates/ }).click()
  await expect(page.getByText(/已是最新版本|is up to date/).first()).toBeVisible()
  expect(await page.evaluate(() => window.piSwitch.updater.state())).toMatchObject({
    status: 'not-available',
    available: false
  })
})

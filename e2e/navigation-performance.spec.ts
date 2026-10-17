import { test, expect } from './fixtures'
import { IPC_INVOKE } from '../src/shared/ipc/channels'

test('switches menus without rechecking executables and keeps explicit system refresh active', async ({
  page,
  electronApp
}) => {
  await page.evaluate(() => window.piSwitch.runtimes.switch('node', { source: 'system' }))
  await page
    .getByRole('button', { name: /^(Refresh|刷新)$/ })
    .first()
    .waitFor()
  await page.waitForTimeout(200)
  await electronApp.evaluate(({ ipcMain }, detectChannel) => {
    const handlers = (
      ipcMain as unknown as { _invokeHandlers: Map<string, (...args: unknown[]) => unknown> }
    )._invokeHandlers
    const original = handlers.get(detectChannel)!
    const state = globalThis as typeof globalThis & {
      __navigationPerf: { detects: number; probes: number }
    }
    state.__navigationPerf = { detects: 0, probes: 0 }
    ipcMain.removeHandler(detectChannel)
    ipcMain.handle(detectChannel, (...args) => {
      state.__navigationPerf.detects++
      return original(...args)
    })
    const child = process.getBuiltinModule('child_process')!
    child.spawn = new Proxy(child.spawn, {
      apply(target, receiver, args) {
        const argv = Array.isArray(args[1]) ? args[1] : []
        if (
          argv.includes('-ilc') ||
          argv.includes('prefix') ||
          argv.includes('--version') ||
          argv.includes('-p')
        )
          state.__navigationPerf.probes++
        return Reflect.apply(target, receiver, args)
      }
    })
    process.getBuiltinModule('module')!.syncBuiltinESMExports()
  }, IPC_INVOKE.piDetect)

  for (let cycle = 0; cycle < 3; cycle++) {
    await page.locator('a[href="#/workspace"]').click()
    await expect(page.getByTestId('workspace-main')).toBeVisible()
    await page.locator('a[href="#/models"]').click()
    await expect(page.getByTestId('model-management-view')).toBeVisible()
    await page.locator('a[href="#/skills"]').click()
    await expect(page.getByRole('heading', { name: /Capability|能力/, level: 1 })).toBeVisible()
    await page.locator('a[href="#/settings"]').click()
    await page.getByTestId('settings-section-overview').click()
    await expect(page.getByRole('heading', { name: /Overview|概览/ })).toBeVisible()
    // Wait for actual capability reads as well as the painted route.
    await page.evaluate(() => window.piSwitch.skills.list())
  }
  const counters = () =>
    electronApp.evaluate(
      () =>
        (
          globalThis as typeof globalThis & {
            __navigationPerf: { detects: number; probes: number }
          }
        ).__navigationPerf
    )
  expect(await counters()).toEqual({ detects: 0, probes: 0 })

  await page
    .getByRole('button', { name: /^(Refresh|刷新)$/ })
    .first()
    .click()
  await expect.poll(async () => (await counters()).detects).toBe(1)
  if (process.platform !== 'win32')
    await expect.poll(async () => (await counters()).probes).toBeGreaterThan(0)
})

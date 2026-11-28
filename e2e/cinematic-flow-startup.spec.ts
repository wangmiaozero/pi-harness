import type { ElectronApplication } from '@playwright/test'
import { IPC_INVOKE } from '../src/shared/ipc/channels'
import { expect, test } from './fixtures'

test.use({ startupBranch: 'flow', waitForStartup: false, petPacks: true })

test('draws the seven scenes and reveals the live workspace', async ({ page }, testInfo) => {
  const flow = page.getByTestId('cinematic-flow-startup')
  await expect(flow).toBeVisible()
  await expect(page.getByTestId('app-shell')).toBeAttached()
  await expect(page.getByTestId('startup-animation')).toHaveCount(0)
  await expect(page.locator('#dsh-startup-root')).toHaveCount(0)
  for (const [stage, checkpoint, label] of [
    ['seed', 300, '01-seed'],
    ['unfold', 2400, '02-wings'],
    ['lettering', 4900, '03-lettering'],
    ['title', 7200, '04-title'],
    ['vortex', 11400, '05-orbit'],
    ['vortex', 13600, '06-contraction'],
    ['mark', 15400, '07-mark-morph'],
    ['mark', 17000, '08-mark']
  ] as const) {
    await page.waitForFunction(
      ({ stage, checkpoint }) => {
        const overlay = document.querySelector<HTMLElement>(
          '[data-testid="cinematic-flow-startup"]'
        )
        return (
          overlay?.dataset.flowStage === stage && Number(overlay.dataset.flowTime) >= checkpoint
        )
      },
      { stage, checkpoint }
    )
    await page.screenshot({ path: testInfo.outputPath(`${label}.png`) })
  }
  await expect(flow).toHaveAttribute('data-flow-stage', 'iris')
  await page.waitForFunction(() => {
    const iris = document.querySelector<HTMLElement>('[data-flow-stage="iris"]')
    // Sample the middle of the actual reveal, once the live shell is visible at the center.
    if (!iris || parseFloat(iris.style.getPropertyValue('--iris')) < innerHeight * 0.24)
      return false
    return document
      .elementFromPoint(innerWidth / 2, innerHeight / 2)
      ?.closest('[data-testid="app-shell"]')
  })
  await page.screenshot({ path: testInfo.outputPath('09-iris.png') })
  await expect(flow).toHaveCount(0)
  await expect(page.locator('html')).not.toHaveAttribute('data-cinematic-flow')
  await expect(page.getByTestId('app-shell')).toBeVisible()
})

for (const input of ['click', 'Escape', 'Space'] as const) {
  test(`skips Cinematic Flow with ${input} and releases the canvas`, async ({ page }) => {
    const flow = page.getByTestId('cinematic-flow-startup')
    const canvas = await flow.locator('canvas').elementHandle()
    expect(canvas).not.toBeNull()
    if (input === 'click') await flow.click()
    else await page.keyboard.press(input)
    await expect(flow).toHaveCount(0)
    expect(await canvas!.evaluate((element) => [element.width, element.height])).toEqual([0, 0])
    await expect(page.getByTestId('startup-animation')).toBeHidden()
    await expect(page.locator('html')).not.toHaveAttribute('data-cinematic-startup')
    await expect(page.getByTestId('app-shell')).toBeVisible()
  })
}

async function holdEnvironmentCheck(electronApp: ElectronApplication) {
  await electronApp.evaluate(({ ipcMain }, channel) => {
    const registry = ipcMain as unknown as {
      _invokeHandlers: Map<string, (...args: unknown[]) => unknown>
    }
    const original = registry._invokeHandlers.get(channel)!
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (...args) => {
      await pending
      return original(...args)
    })
    ipcMain.once('e2e:release-cinematic-flow', release)
  }, IPC_INVOKE.piDetect)
  return () =>
    electronApp.evaluate(({ ipcMain }) => {
      ipcMain.emit('e2e:release-cinematic-flow')
    })
}

test('keeps safe loading after an early skip until the service replies', async ({
  page,
  electronApp
}) => {
  const release = await holdEnvironmentCheck(electronApp)
  await page.reload()
  const flow = page.getByTestId('cinematic-flow-startup')
  await expect(flow).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(flow).toHaveCount(0)
  const loading = page.getByTestId('startup-animation')
  await expect(loading).toHaveAttribute('data-flow-wait', 'true')
  await expect(loading).toContainText('运行环境')
  await release()
  await expect(loading).toHaveCount(0)
})

test('leaves the live shell usable when the service never replies before the deadline', async ({
  page,
  electronApp
}) => {
  const release = await holdEnvironmentCheck(electronApp)
  await page.reload()
  const flow = page.getByTestId('cinematic-flow-startup')
  try {
    await page.waitForFunction(() => document.querySelector('[data-flow-stage="waiting"]'))
    await expect(flow).toHaveCount(0)
    await expect(page.getByTestId('startup-animation')).toHaveCount(0)
    await expect(page.getByTestId('app-shell')).toBeVisible()
  } finally {
    await release()
  }
})

test('cleans up and falls back when the canvas context is lost', async ({ page }) => {
  const flow = page.getByTestId('cinematic-flow-startup')
  const canvas = await flow.locator('canvas').elementHandle()
  expect(canvas).not.toBeNull()
  await canvas!.dispatchEvent('contextlost')
  await expect(flow).toHaveCount(0)
  expect(await canvas!.evaluate((element) => [element.width, element.height])).toEqual([0, 0])
  await expect(page.getByTestId('startup-animation')).toBeHidden()
  await expect(page.getByTestId('app-shell')).toBeVisible()
})

test('honors Reduced Motion before creating a canvas', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.addInitScript(() => {
    const observing = new MutationObserver(() => {
      if (document.querySelector('[data-testid="cinematic-flow-startup"]')) {
        document.documentElement.dataset.flowCanvasSeen = 'true'
      }
    })
    observing.observe(document, { childList: true, subtree: true })
  })
  await page.reload()
  await expect(page.getByTestId('app-shell')).toBeVisible()
  await expect(page.locator('html')).not.toHaveAttribute('data-cinematic-startup')
  await expect(page.locator('html')).not.toHaveAttribute('data-flow-canvas-seen')
  await expect(page.getByTestId('cinematic-flow-startup')).toHaveCount(0)
})

test('continues startup when Canvas 2D fails to initialize', async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext
    const patched: typeof getContext = function (this: HTMLCanvasElement, ...args: unknown[]) {
      if (this.closest('[data-testid="cinematic-flow-startup"]')) {
        document.documentElement.dataset.flowContextFailed = 'true'
        return null
      }
      return Reflect.apply(getContext, this, args)
    }
    HTMLCanvasElement.prototype.getContext = patched
  })
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-flow-context-failed', 'true')
  await expect(page.getByTestId('cinematic-flow-startup')).toHaveCount(0)
  await expect(page.getByTestId('startup-animation')).toHaveCount(0)
  await expect(page.getByTestId('app-shell')).toBeVisible()
})

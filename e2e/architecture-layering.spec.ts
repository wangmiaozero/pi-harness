import fs from 'node:fs'
import path from 'node:path'
import { test, expect } from './fixtures'

test('keeps native architecture content behind the startup animation during reload', async ({
  page,
  electronApp,
  workspaceRoot
}, testInfo) => {
  fs.writeFileSync(path.join(workspaceRoot, 'main.ts'), "import './service'\nexport const app = 1")
  fs.writeFileSync(path.join(workspaceRoot, 'service.ts'), 'export const service = 1')
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
  const nativeVisible = () =>
    electronApp.evaluate(({ BrowserWindow, WebContentsView }) =>
      BrowserWindow.getAllWindows().some((window) =>
        window.contentView.children.some(
          (child) =>
            child instanceof WebContentsView &&
            child.webContents.getURL().startsWith('pi-architecture:') &&
            child.getVisible()
        )
      )
    )
  await expect.poll(nativeVisible).toBe(true)

  await page.reload()
  const startup = page.getByTestId('startup-animation')
  await expect(startup).toBeVisible()
  expect(await nativeVisible()).toBe(false)

  // Open the restored map underneath the overlay to exercise its startup gate.
  await page.getByTestId('workspace-architecture').dispatchEvent('click')
  await expect(page.getByTestId('architecture-viewer')).toBeVisible()
  await expect(startup).toBeVisible()
  expect(await nativeVisible()).toBe(false)
  await page.screenshot({ path: testInfo.outputPath('startup-above-architecture.png') })
  while (await startup.isVisible()) {
    if (await nativeVisible()) expect(await startup.isVisible()).toBe(false)
    await page.waitForTimeout(100)
  }
  await expect.poll(nativeVisible).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('architecture-after-startup.png') })
})

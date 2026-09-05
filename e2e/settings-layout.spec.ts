import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from './fixtures'

const { version: APP_VERSION } = JSON.parse(fs.readFileSync('package.json', 'utf8')) as {
  version: string
}

test('uses a conventional settings sidebar and displays the current application version', async ({
  page
}, testInfo) => {
  await page.setViewportSize({ width: 1712, height: 1006 })
  await page.evaluate(() => window.piSwitch.settings.set({ theme: 'dark' }))
  await page.locator('a[href="#/settings"]').click()

  const layout = page.getByTestId('settings-layout')
  const sidebar = page.getByTestId('settings-home')
  await expect(layout).toBeVisible()
  await expect(page.locator('h1').filter({ hasText: /通用|General/ })).toBeVisible()
  await expect(page.locator('.settings-home-card')).toHaveCount(0)
  await expect(sidebar.getByTestId('settings-section-general')).toHaveAttribute(
    'aria-current',
    'page'
  )

  const sidebarBox = await sidebar.locator('..').boundingBox()
  expect(sidebarBox?.width).toBeCloseTo(220, 0)

  const version = page.getByTestId('settings-version')
  await expect(version).toContainText('Pi-Harness')
  await expect(version).toContainText(APP_VERSION)

  await page.screenshot({
    path: path.join(
      process.env.PI_HARNESS_DESIGN_QA_DIR ?? testInfo.outputDir,
      'settings-layout-dark.png'
    )
  })
})

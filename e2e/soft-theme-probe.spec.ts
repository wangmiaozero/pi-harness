import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from './fixtures'

// Design-qa probe: render the workspace in both soft themes via the picker.
const themes = [
  { value: 'soft-dark', label: /柔和深色|Soft Dark/ },
  { value: 'soft-light', label: /柔和浅色|Soft Light/ }
] as const

for (const { value, label } of themes) {
  test(`renders ${value} in the workspace`, async ({ page }, testInfo) => {
    await expect(page.getByText('Pi-Harness').first()).toBeVisible({ timeout: 30_000 })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.locator('a[href="#/settings"]').click()
    await expect(page.locator('h1').filter({ hasText: /通用|General/ })).toBeVisible()

    const themeSelect = page.getByRole('button', { name: /主题|Theme/, exact: true })
    await themeSelect.click()
    await page.getByRole('option', { name: label, exact: true }).click()

    const root = page.locator('html')
    await expect(root).toHaveAttribute('data-theme', value)
    await expect(root).toHaveAttribute(
      'data-appearance',
      value === 'soft-dark' ? 'dark' : 'light'
    )

    await page.locator('a[href="#/workspace"]').click()
    await expect(page.locator('[data-testid="chat-window"]')).toBeVisible()
    const qaDir = process.env.PI_HARNESS_DESIGN_QA_DIR ?? testInfo.outputDir
    fs.mkdirSync(qaDir, { recursive: true })
    await page.screenshot({ path: path.join(qaDir, `theme-${value}.png`) })
    await page.locator('a[href="#/settings"]').click()
    await page.screenshot({ path: path.join(qaDir, `theme-${value}-settings.png`) })
  })
}

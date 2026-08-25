import { test, expect } from './fixtures'

test.describe('Application shell', () => {
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
})

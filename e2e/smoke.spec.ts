import { test, expect } from './fixtures'

test.describe('Pi-Switch smoke', () => {
  test('launches and shows overview', async ({ page }) => {
    await expect(page.getByText('Pi-Switch').first()).toBeVisible({ timeout: 30_000 })
    // zh-CN default label for Overview is 「概览」
    await expect(page.locator('a[href="#/"]').filter({ hasText: /概览|Overview/ })).toBeVisible()
  })

  test('navigates Providers / Models / Settings / Config', async ({ page }) => {
    await expect(page.getByText('Pi-Switch').first()).toBeVisible({ timeout: 30_000 })

    await page.locator('a[href="#/providers"]').click()
    await expect(page.locator('h1').filter({ hasText: /提供商|Providers/ })).toBeVisible()

    await page.locator('a[href="#/models"]').click()
    await expect(page.locator('h1').filter({ hasText: /模型|Models/ })).toBeVisible()

    await page.locator('a[href="#/settings"]').click()
    await expect(page.locator('h1').filter({ hasText: /设置|Settings/ })).toBeVisible()

    await page.locator('a[href="#/config"]').click()
    await expect(page.getByText(/models\.json/i).first()).toBeVisible()
  })
})

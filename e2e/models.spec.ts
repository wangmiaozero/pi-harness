import { test, expect } from './fixtures'

test.describe('Models', () => {
  test('prevents duplicate model ids before save', async ({ page }) => {
    const pageErrors: string[] = []
    const consoleErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })

    await expect(page.getByText('Pi-Harness').first()).toBeVisible({ timeout: 30_000 })
    await page.locator('a[href="#/models"]').click()
    await page.getByRole('button', { name: /新建模型|New model/ }).click()

    const dialog = page.getByRole('dialog')
    await page.mouse.click(5, 5)
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
    const modelId = dialog.getByLabel(/模型 ID|Model ID/)
    await modelId.fill('gpt-4o')
    await expect(dialog).toContainText(/已存在模型.*gpt-4o|Model.*gpt-4o.*already exists/)
    await expect(dialog.getByRole('button', { name: /保存|Save/ })).toBeDisabled()

    expect(pageErrors).toEqual([])
    expect(consoleErrors).toEqual([])
  })
})

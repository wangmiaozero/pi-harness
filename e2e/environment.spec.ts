import { test, expect } from './fixtures'

test.describe('Environment', () => {
  test('opens the install confirmation when Pi is missing', async ({ page }) => {
    const pageErrors: string[] = []
    const consoleErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    await expect(page.getByText('Pi-Harness').first()).toBeVisible({ timeout: 30_000 })

    await page.getByRole('button', { name: /一键安装|安装 Pi|Install Pi/ }).click()

    await page.waitForTimeout(250)
    expect(pageErrors).toEqual([])
    expect(consoleErrors).toEqual([])

    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('dialog')).toContainText(/安装 Pi|Install Pi/)
  })
})

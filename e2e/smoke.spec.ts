import { test, expect } from './fixtures'

test.describe('Pi-Harness smoke', () => {
  test('launches and shows overview', async ({ page }) => {
    await expect(page.getByText('Pi-Harness').first()).toBeVisible({ timeout: 30_000 })
    // zh-CN default label for Overview is 「概览」
    await expect(page.locator('a[href="#/"]').filter({ hasText: /概览|Overview/ })).toBeVisible()
  })

  test('navigates Providers / Models / Settings / Config', async ({ page }) => {
    await expect(page.getByText('Pi-Harness').first()).toBeVisible({ timeout: 30_000 })

    await page.locator('a[href="#/providers"]').click()
    await expect(page.locator('h1').filter({ hasText: /提供商|Providers/ })).toBeVisible()

    await page.locator('a[href="#/models"]').click()
    await expect(page.locator('h1').filter({ hasText: /模型|Models/ })).toBeVisible()

    await page.locator('a[href="#/settings"]').click()
    await expect(page.locator('h1').filter({ hasText: /设置|Settings/ })).toBeVisible()

    await page.locator('a[href="#/config"]').click()
    await expect(page.getByText(/models\.json/i).first()).toBeVisible()
  })

  test('opens the create provider dialog', async ({ page }) => {
    const pageErrors: string[] = []
    const consoleErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message))
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') {
        consoleErrors.push(message.text())
      }
    })
    await expect(page.getByText('Pi-Harness').first()).toBeVisible({ timeout: 30_000 })

    await page.locator('a[href="#/providers"]').click()
    await page.getByRole('button', { name: /新建提供商|New provider/ }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(/新建提供商|New provider/)
    await expect(dialog.getByRole('button', { name: /保存|Save/ })).toBeVisible()

    const apiKeyType = dialog.getByRole('button', {
      name: /API 密钥类型|API key type/,
      exact: true
    })
    await apiKeyType.click()
    await page.getByRole('option', { name: /明文|Literal \(plaintext\)/, exact: true }).click()
    await expect(apiKeyType).toContainText(/明文|Literal \(plaintext\)/)

    expect(pageErrors).toEqual([])
    expect(consoleErrors).toEqual([])
  })

  test('shows local skills and the curated extension market', async ({ page }) => {
    await expect(page.getByText('Pi-Harness').first()).toBeVisible({ timeout: 30_000 })

    await page.locator('a[href="#/skills"]').click()
    await expect(page.locator('h1').filter({ hasText: /技能|Skills/ })).toBeVisible()
    await expect(page.locator('ul').getByText('demo-skill', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: /市场|Market/ }).click()
    await expect(page.getByText(/日常开发套件|Core Development/).first()).toBeVisible()
    await expect(page.getByText(/Agent 架构套件|Agent Architecture/).first()).toBeVisible()
    await expect(page.getByText(/精选扩展|Curated Extensions/).first()).toBeVisible()
    await expect(page.getByText(/Pi Coding Agent.*一键安装/)).toHaveCount(0)
    await expect(page.getByText(/方案内容|Recipe content/)).toHaveCount(0)
  })

  test('saves the light theme without requiring Pi', async ({ page }) => {
    await expect(page.getByText('Pi-Harness').first()).toBeVisible({ timeout: 30_000 })

    await page.locator('a[href="#/settings"]').click()
    await expect(page.locator('h1').filter({ hasText: /设置|Settings/ })).toBeVisible()
    await page.getByRole('button', { name: /主题|Theme/, exact: true }).click()
    await page.getByRole('option', { name: /浅色|Light/, exact: true }).click()
    await page.getByRole('button', { name: /保存|Save/ }).click()

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  })

  test('opens the install confirmation when Pi is missing', async ({ page }) => {
    const pageErrors: string[] = []
    const consoleErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    await expect(page.getByText('Pi-Harness').first()).toBeVisible({ timeout: 30_000 })

    await page.getByRole('button', { name: /安装 Pi|Install Pi/ }).click()

    await page.waitForTimeout(250)
    expect(pageErrors).toEqual([])
    expect(consoleErrors).toEqual([])

    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('dialog')).toContainText(/安装 Pi|Install Pi/)
  })
})

import { test, expect } from './fixtures'

test.describe('Providers', () => {
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
    const presetPicker = page.getByPlaceholder(/搜索并选择厂商|Search and select a provider/)
    await presetPicker.fill('DeepSeek')
    await page
      .locator('[data-combobox-panel]')
      .getByRole('button', { name: /DeepSeek/ })
      .click()

    let dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel(/提供商标识|Provider key/)).toHaveValue('deepseek')
    await expect(dialog.getByLabel(/显示名称|Display name/)).toHaveValue('DeepSeek')
    await expect(dialog.getByLabel(/API 基础 URL|API Base URL/)).toHaveValue(
      'https://api.deepseek.com'
    )
    await expect(
      dialog.getByRole('button', { name: /API 密钥类型|API key type/, exact: true })
    ).toContainText(/明文|Literal/)
    await expect(dialog.getByLabel(/API 密钥$|API key$/)).toBeVisible()
    await expect(dialog.getByLabel(/默认模型 ID|Default model ID/)).toHaveValue('deepseek-v4-flash')
    await dialog.getByLabel(/默认模型 ID|Default model ID/).click()
    const deepSeekChat = page
      .locator('[data-combobox-panel]')
      .getByRole('button', { name: /DeepSeek Chat/ })
    await expect(deepSeekChat).toBeVisible()
    await deepSeekChat.click()
    await expect(dialog.getByLabel(/默认模型 ID|Default model ID/)).toHaveValue('deepseek-chat')
    await dialog.getByRole('button', { name: /取消|Cancel/ }).click()

    await page.getByRole('button', { name: /新建提供商|New provider/ }).click()
    dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(/新建提供商|New provider/)
    await expect(dialog.getByRole('button', { name: /保存|Save/ })).toBeVisible()

    await page.mouse.click(5, 5)
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()

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
})

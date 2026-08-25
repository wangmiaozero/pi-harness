import { test, expect } from './fixtures'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { once } from 'node:events'

test.describe('Providers', () => {
  test('keeps provider actions aligned and fixed to the right', async ({ page }) => {
    await expect(page.getByText('Pi-Harness').first()).toBeVisible({ timeout: 30_000 })
    await page.setViewportSize({ width: 960, height: 720 })
    await page.locator('a[href="#/providers"]').click()

    const table = page.getByTestId('providers-table-scroll')
    const actionCells = page.getByTestId('provider-action-cell')
    await expect(actionCells).toHaveCount(2)

    const before = await actionCells.evaluateAll((cells) =>
      cells.map((cell) => cell.getBoundingClientRect().left)
    )
    expect(new Set(before.map(Math.round)).size).toBe(1)

    await table.evaluate((element) => {
      element.scrollLeft = element.scrollWidth
    })
    const [tableBox, actionBox] = await Promise.all([
      table.boundingBox(),
      actionCells.first().boundingBox()
    ])
    expect(tableBox).not.toBeNull()
    expect(actionBox).not.toBeNull()
    expect(Math.abs(actionBox!.x + actionBox!.width - tableBox!.x - tableBox!.width)).toBeLessThan(
      3
    )
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
    await expect(dialog.getByLabel(/内部名称|Internal name/)).toHaveValue('deepseek')
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

    await dialog.getByLabel(/API 基础 URL|Base URL/).fill('https://integrate.api.nvidia.com/v1')
    await dialog
      .getByRole('button', { name: /根据 URL 生成标识与名称|Generate identity from URL/ })
      .click()
    await expect(dialog.getByLabel(/提供商标识|Provider key/)).toHaveValue('nvidia')
    await expect(dialog.getByLabel(/显示名称|Display name/)).toHaveValue('NVIDIA')
    await expect(dialog.getByLabel(/内部名称|Internal name/)).toHaveValue('nvidia')
    await expect(
      dialog.getByRole('button', { name: /一键获取全部模型|Fetch all models/ })
    ).toBeVisible()

    expect(pageErrors).toEqual([])
    expect(consoleErrors).toEqual([])
  })

  test('fetches all provider models and imports them on save', async ({ page }) => {
    const server = createServer((request, response) => {
      if (request.url?.startsWith('/empty/models')) {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ data: [] }))
        return
      }
      if (request.url?.startsWith('/failure/models')) {
        response.writeHead(404, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ error: { message: 'models endpoint unavailable' } }))
        return
      }
      if (request.url?.startsWith('/v1/models')) {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(
          JSON.stringify({
            data: [
              { id: 'acme-chat', name: 'Acme Chat' },
              { id: 'acme-reasoning', name: 'Acme Reasoning' }
            ]
          })
        )
        return
      }
      response.writeHead(404).end()
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')

    try {
      const port = (server.address() as AddressInfo).port
      await expect(page.getByText('Pi-Harness').first()).toBeVisible({ timeout: 30_000 })
      await page.locator('a[href="#/providers"]').click()
      await page.getByRole('button', { name: /新建提供商|New provider/ }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByLabel(/API 基础 URL|Base URL/).fill(`http://127.0.0.1:${port}/v1`)
      await dialog.getByRole('button', { name: /一键获取全部模型|Fetch all models/ }).click()

      await expect(dialog).toContainText(/保存后将导入 2 个模型|2 models will be imported on save/)
      await expect(dialog.getByLabel(/默认模型 ID|Default model ID/)).toHaveValue('acme-chat')
      await dialog.getByLabel(/默认模型 ID|Default model ID/).click()
      const modelPanel = page.locator('[data-combobox-panel]')
      await expect(modelPanel.getByRole('button', { name: /Acme Chat/ })).toBeVisible()
      await expect(modelPanel.getByRole('button', { name: /Acme Reasoning/ })).toBeVisible()

      await dialog.getByLabel(/API 基础 URL|Base URL/).fill(`http://127.0.0.1:${port}/empty`)
      await dialog.getByRole('button', { name: /一键获取全部模型|Fetch all models/ }).click()
      await expect(dialog.getByRole('status')).toContainText(
        /厂商没有返回任何模型|provider returned no models/
      )

      await dialog.getByLabel(/API 基础 URL|Base URL/).fill(`http://127.0.0.1:${port}/failure`)
      await dialog.getByRole('button', { name: /一键获取全部模型|Fetch all models/ }).click()
      await expect(dialog.getByRole('status')).toContainText(/获取模型失败|Failed to fetch models/)

      await dialog.getByLabel(/提供商标识|Provider key/).fill('acme-discovery')
      await dialog.getByLabel(/显示名称|Display name/).fill('Acme Discovery')
      await dialog.getByLabel(/内部名称|Internal name/).fill('acme-discovery')
      await dialog.getByLabel(/API 基础 URL|Base URL/).fill(`http://127.0.0.1:${port}/v1`)
      await dialog.getByRole('button', { name: /一键获取全部模型|Fetch all models/ }).click()
      await expect(dialog.getByRole('status')).toContainText(
        /保存后将导入 2 个模型|2 models will be imported on save/
      )
      await dialog.getByRole('button', { name: /保存|Save/, exact: true }).click()
      await expect(dialog).toBeHidden()
      const importedModels = await page.evaluate(() => window.piSwitch?.models.list())
      expect(importedModels?.filter((model) => model.providerId === 'acme-discovery')).toHaveLength(
        2
      )
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  })
})

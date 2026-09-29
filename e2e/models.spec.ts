import { test, expect } from './fixtures'

test.describe('Models', () => {
  test('requires a configured provider before models can be managed', async ({ page }) => {
    await expect(page.getByText('Pi-Harness').first()).toBeVisible({ timeout: 30_000 })
    await page.evaluate(async () => {
      const providers = (await window.piSwitch?.providers.list()) ?? []
      for (const provider of providers) {
        await window.piSwitch?.providers.delete(provider.key, { overwrite: true })
      }
    })

    await page.locator('a[href="#/models"]').click()
    await expect(page.getByTestId('model-management-tab-providers')).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await expect(page.getByTestId('model-management-tab-models')).toBeDisabled()
    await expect(
      page.getByText(/请先配置厂商，再配置模型|Configure a provider before/)
    ).toBeVisible()
  })

  test('keeps model actions aligned and fixed to the right', async ({ page }) => {
    await expect(page.getByText('Pi-Harness').first()).toBeVisible({ timeout: 30_000 })
    await page.setViewportSize({ width: 960, height: 720 })
    await page.locator('a[href="#/models"]').click()

    const table = page.getByTestId('models-table-scroll')
    const actionCells = page.getByTestId('model-action-cell')
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

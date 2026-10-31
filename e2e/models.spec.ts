import { test, expect } from './fixtures'

test.describe('Models', () => {
  test('fills current model defaults on typing and selection while preserving manual values', async ({
    page
  }) => {
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') pageErrors.push(message.text())
    })
    await page.locator('a[href="#/models"]').click()
    await page.getByRole('button', { name: /新建模型|New model/ }).click()
    const dialog = page.getByRole('dialog')
    const id = dialog.getByLabel(/模型 ID|Model ID/)
    const context = dialog.getByLabel(/上下文窗口|Context window/)
    const output = dialog.getByLabel(/最大输出 token|Max output tokens/)
    await id.fill('gpt-6.1-sol')
    await id.press('Escape')
    await expect(context).toHaveValue('1050000')
    await expect(output).toHaveValue('128000')
    for (const name of [/视觉|Vision/, /工具|Tools/, /推理|Reasoning/, /流式|Streaming/])
      await expect(dialog.getByRole('checkbox', { name })).toBeChecked()
    await dialog.getByRole('button', { name: /显示高级选项|Show advanced/ }).click()
    await expect(dialog.getByLabel('off', { exact: true })).toHaveValue('')
    await expect(dialog.getByLabel('max', { exact: true })).toHaveValue('max')
    await context.fill('50000')
    await id.fill('unknown-local-model')
    await id.press('Escape')
    await expect(context).toHaveValue('50000')
    await expect(output).toHaveValue('8192')
    await expect(dialog.getByLabel('medium', { exact: true })).toHaveValue('medium')
    await expect(dialog.getByLabel('max', { exact: true })).toHaveValue('')
    await context.fill('')
    await id.fill('gpt-6-luna')
    await page.getByRole('button', { name: /GPT-6 Luna/ }).click()
    await expect(output).toHaveValue('128000')
    await expect(dialog.getByLabel('off', { exact: true })).toHaveValue('none')
    await expect(context).toHaveValue('1050000')
    await context.fill('1050000')
    await dialog.getByRole('button', { name: /保存|Save/ }).click()
    await expect(page.locator('[data-sonner-toast]')).toContainText(/模型已创建|Model created/)
    await expect
      .poll(async () => ({ dialogs: await dialog.count(), errors: pageErrors }))
      .toEqual({ dialogs: 0, errors: [] })
    const saved = await page.evaluate(async () =>
      (await window.piSwitch.models.list()).find((m) => m.modelId === 'gpt-6-luna')
    )
    expect(saved).toMatchObject({
      contextWindow: 1050000,
      maxOutputTokens: 128000,
      vision: true,
      tools: true,
      reasoning: true,
      streaming: true,
      thinkingLevels: { off: 'none', minimal: null, max: 'max' }
    })
  })
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

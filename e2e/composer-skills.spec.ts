import { test, expect } from './fixtures'

test('mentions installed Skills from the workspace composer', async ({ page }) => {
  await page.locator('a[href="#/workspace"]').click()
  const composer = page.getByTestId('chat-composer')
  const input = composer.getByTestId('composer-editor')

  await input.click()
  await expect
    .poll(() => input.evaluate((element) => getComputedStyle(element).boxShadow))
    .toBe('none')
  await input.pressSequentially('Use @demo')
  const menu = page.getByTestId('composer-skill-menu')
  await expect(menu).toBeVisible()
  await expect(menu).toContainText('demo-skill')
  const menuBox = await menu.boundingBox()
  expect(menuBox?.width).toBeLessThanOrEqual(560)

  await input.press('Enter')
  await expect(input).toHaveText('Use')
  const chip = composer.getByTestId('composer-skill-chip')
  await expect(chip).toContainText('@demo-skill')
  await expect(menu).toHaveCount(0)

  await chip.getByRole('button').click()
  await expect(chip).toHaveCount(0)
})

test('keeps the native caret visible in an empty focused composer', async ({ page }) => {
  await page.locator('a[href="#/workspace"]').click()
  const input = page.getByTestId('composer-editor')
  await input.click()
  await expect(input).toBeFocused()
  await expect(input).toHaveCSS('display', 'inline-block')
  const styles = await input.evaluate((element) => ({
    caret: getComputedStyle(element).caretColor,
    text: getComputedStyle(element).color,
    placeholderPosition: getComputedStyle(element, '::before').position,
    height: element.getBoundingClientRect().height,
    hasSelection: element.contains(window.getSelection()?.anchorNode ?? null)
  }))
  expect(styles.caret).toBe(styles.text)
  expect(styles.placeholderPosition).toBe('absolute')
  expect(styles.height).toBeGreaterThan(0)
  expect(styles.hasSelection).toBe(true)
  await input.pressSequentially('hello')
  await expect(input).toHaveText('hello')
  await input.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
  await input.press('Backspace')
  await expect(input).toHaveText('')
  await expect(input).toBeFocused()
  await expect(input).toHaveCSS('display', 'inline-block')
})

test('keeps the model submenu adjacent to its vendor panel', async ({ page }) => {
  await page.locator('a[href="#/workspace"]').click()
  for (const size of [
    { width: 1280, height: 900 },
    { width: 1000, height: 700 }
  ]) {
    await page.setViewportSize(size)
    await page.getByTestId('workspace-model-select').getByRole('button').click()
    const vendors = page.getByTestId('composer-vendor-panel')
    const models = page.getByTestId('composer-model-panel')
    await expect(models).toBeVisible()
    async function bottomGap() {
      const vendorBox = (await vendors.boundingBox())!
      const modelBox = (await models.boundingBox())!
      return Math.abs(vendorBox.y + vendorBox.height - modelBox.y - modelBox.height)
    }
    await expect.poll(bottomGap).toBeLessThanOrEqual(2)
    await page.getByTestId('composer-model-search').fill('no-matching-model')
    await expect.poll(bottomGap).toBeLessThanOrEqual(2)
    await page.keyboard.press('Escape')
  }
})

test('closes the model picker after mouse or keyboard selection', async ({ page }) => {
  await page.locator('a[href="#/workspace"]').click()
  const trigger = page.getByTestId('workspace-model-select').getByRole('button')
  for (const keyboard of [false, true]) {
    await trigger.click()
    const option = page.getByRole('option').first()
    const modelName = (await option.innerText()).trim()
    if (keyboard) {
      await option.focus()
      await option.press('Enter')
    } else {
      await option.click()
    }
    await expect(page.getByTestId('composer-model-panel')).toHaveCount(0)
    await expect(page.getByTestId('composer-vendor-panel')).toHaveCount(0)
    await expect(trigger).toContainText(modelName)
    await expect(trigger).toBeFocused()
  }
})

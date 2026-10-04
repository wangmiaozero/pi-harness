import { test, expect } from './fixtures'

test('mentions installed Skills from the workspace composer', async ({ page }) => {
  await page.locator('a[href="#/workspace"]').click()
  const composer = page.getByTestId('chat-composer')
  const input = composer.locator('textarea')

  await input.fill('Use @demo')
  const menu = page.getByTestId('composer-skill-menu')
  await expect(menu).toBeVisible()
  await expect(menu).toContainText('demo-skill')
  const menuBox = await menu.boundingBox()
  expect(menuBox?.width).toBeLessThanOrEqual(560)

  await input.press('Enter')
  await expect(input).toHaveValue('Use @demo-skill ')
  await expect(menu).toHaveCount(0)
})

import path from 'node:path'
import { test, expect } from './fixtures'

test('Home and Models stay above More while Settings stays at the bottom', async ({
  page
}, testInfo) => {
  await page.setViewportSize({ width: 1200, height: 780 })
  const rail = page.getByTestId('app-navigation-rail')
  const more = page.getByTestId('navigation-more')
  const menu = page.getByTestId('navigation-more-menu')
  const settings = page.getByTestId('navigation-settings')
  await expect(rail.locator('nav a')).toHaveCount(2)
  await expect(rail.locator('nav a').first()).toHaveAttribute('href', '#/workspace')
  await expect(rail.locator('nav a').first()).toHaveAttribute('aria-label', '首页')
  await expect(rail.locator('nav a').nth(1)).toHaveAttribute('href', '#/models')
  await expect(rail.locator('nav a').first()).toHaveText('')
  expect((await rail.boundingBox())!.width).toBe(52)
  const railBox = (await rail.boundingBox())!
  const settingsBox = (await settings.boundingBox())!
  expect(railBox.y + railBox.height - settingsBox.y - settingsBox.height).toBeLessThanOrEqual(16)
  await rail.locator('nav a').first().hover()
  await expect(page.getByRole('tooltip')).toHaveText('首页')
  await page.screenshot({ path: path.join(testInfo.outputDir, 'navigation-home-tooltip.png') })
  const home = rail.locator('nav a').first()
  await home.click()
  await expect(home).toBeFocused()
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await page.mouse.move(600, 400)
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await page.keyboard.press('Tab')
  await expect(rail.locator('nav a').nth(1)).toBeFocused()
  await expect(page.getByRole('tooltip')).toHaveText('模型')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await page.keyboard.press('Shift+Tab')
  await expect(home).toBeFocused()
  await expect(page.getByRole('tooltip')).toHaveText('首页')
  await page.mouse.move(600, 400)
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await rail.locator('nav a').nth(1).hover()
  await expect(page.getByRole('tooltip')).toHaveText('模型')
  await settings.hover()
  await expect(page.getByRole('tooltip')).toHaveText('设置')
  await more.hover()
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await more.click()
  await expect(menu.locator('a')).toHaveCount(3)
  await expect(menu.locator('a')).toHaveText(['Git', 'AI 会话', '能力中心'])
  await expect(menu.locator('[role="menuitemcheckbox"]')).toHaveCount(0)
  await page.screenshot({ path: path.join(testInfo.outputDir, 'navigation-more-light.png') })
  for (const destination of ['git', 'ai-sessions', 'skills']) {
    if (!(await menu.isVisible())) await more.click()
    await menu.locator(`a[href="#/${destination}"]`).click()
    await expect(page).toHaveURL(new RegExp(`#/${destination}`))
    await expect(menu).toBeHidden()
    await expect(more).toHaveClass(/bg-\[var\(--bg-surface-raised\)\]/)
  }
  await settings.click()
  await expect(page).toHaveURL(/#\/settings\//)
  await expect(settings).toHaveClass(/bg-\[var\(--bg-surface-raised\)\]/)
  await expect(more).not.toHaveClass(/bg-\[var\(--bg-surface-raised\)\]/)
  await page.evaluate(() => window.piSwitch.settings.set({ theme: 'dark' }))
  await page.reload()
  await more.click()
  await expect(menu).toBeVisible()
  await page.screenshot({ path: path.join(testInfo.outputDir, 'navigation-more-dark.png') })
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(more).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(menu).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(more).toBeFocused()
  await page.setViewportSize({ width: 900, height: 600 })
  const compactRail = (await rail.boundingBox())!
  const compactSettings = (await settings.boundingBox())!
  expect(compactRail.width).toBe(52)
  expect(
    compactRail.y + compactRail.height - compactSettings.y - compactSettings.height
  ).toBeLessThanOrEqual(16)
})

test('navigation width and bottom Settings remain fixed across skins', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 780 })
  await page.evaluate(() => window.piSwitch.settings.unlockMascot('1024'))
  for (const mascotStyle of ['none', 'starshipCockpit', 'mingMoon', 'zhangJuzhengSnow'] as const) {
    await page.evaluate(
      (mascotStyle) => window.piSwitch.settings.set({ theme: 'dark', mascotStyle }),
      mascotStyle
    )
    await page.reload()
    const rail = page.getByTestId('app-navigation-rail')
    await expect(rail.locator('nav a')).toHaveCount(2)
    expect((await rail.boundingBox())!.width).toBe(52)
    const railBox = (await rail.boundingBox())!
    const settingsBox = (await page.getByTestId('navigation-settings').boundingBox())!
    expect(railBox.y + railBox.height - settingsBox.y - settingsBox.height).toBeLessThanOrEqual(16)
    await page.getByTestId('navigation-more').click()
    await expect(page.getByTestId('navigation-more-menu').locator('a')).toHaveCount(3)
    await page.keyboard.press('Escape')
  }
})

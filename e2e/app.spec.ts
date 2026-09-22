import { test, expect } from './fixtures'

test.describe('Application shell', () => {
  test('shows the particle startup animation on each window load', async ({ page }) => {
    await page.reload()
    await expect(page.getByTestId('startup-animation')).toBeVisible()
    await expect(page.getByTestId('startup-animation')).toContainText('检测')
    await expect(page.getByTestId('startup-check-network')).toContainText(
      /已连接|连接失败|检测失败/
    )
    await expect(page.getByTestId('startup-check-node')).toContainText(
      /已就绪|未检测到|版本过低|检测失败/
    )
    await expect(page.getByTestId('startup-check-npm')).toContainText(/已就绪|未检测到|检测失败/)
    await expect(page.getByTestId('startup-animation')).toBeHidden({ timeout: 12_000 })
  })

  test('keeps the command palette open until its close button is used', async ({ page }) => {
    await expect(page.getByText('Pi-Harness').first()).toBeVisible({ timeout: 30_000 })
    await page.keyboard.press('Meta+K')

    const palette = page.getByRole('dialog', { name: /命令面板|Command Palette/ })
    await expect(palette).toBeVisible()
    await page.mouse.click(5, 5)
    await expect(palette).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(palette).toBeVisible()
    await palette.getByRole('button', { name: /关闭|Close/ }).click()
    await expect(palette).toBeHidden()
  })

  test('uses a distinct startup quantum variant for each unlocked theme', async ({
    page
  }, testInfo) => {
    await page.evaluate(() => window.piSwitch.settings.unlockMascot('1024'))
    for (const style of [
      'maidWhite',
      'office',
      'starshipCockpit',
      'noirScholar',
      'moonlitMaid',
      'mingSnow',
      'mingMoon'
    ] as const) {
      await page.evaluate((mascotStyle) => window.piSwitch.settings.set({ mascotStyle }), style)
      await page.reload()
      await expect(page.getByTestId('startup-animation')).toHaveAttribute(
        'data-startup-variant',
        style
      )
      await expect(page.getByTestId('startup-animation')).toHaveCSS('background-color', /rgb\(/)
      await page.screenshot({ path: testInfo.outputPath(`startup-${style}.png`) })
    }

    await page.evaluate(() => window.piSwitch.settings.set({ mascotStyle: 'none' }))
    await page.reload()
    await expect(page.getByTestId('startup-animation')).toHaveAttribute(
      'data-startup-variant',
      'none'
    )
  })
})

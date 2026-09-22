import { expect, test } from './fixtures'

test.skip(process.env.PI_HARNESS_E2E_VARIANT !== 'nomascot', 'Requires pnpm compile:nomascot')

test('keeps the default animation and auto icon without mascot themes', async ({ page }) => {
  await page.evaluate(async () => {
    await window.piSwitch.settings.unlockMascot('1024')
    await window.piSwitch.settings.set({ appIcon: 'auto', mascotStyle: 'mingSnow' })
  })
  await page.reload()

  await expect(page.getByTestId('startup-animation')).toHaveAttribute(
    'data-startup-variant',
    'none'
  )
  await expect(page.getByTestId('startup-animation')).toBeHidden({ timeout: 12_000 })
  await expect(page.getByTestId('titlebar-brand-icon')).toHaveAttribute('src', /app-icon-classic/)

  await page.locator('a[href="#/settings"]').click()
  const iconSettings = page.getByTestId('app-icon-settings')
  const autoIconLabel = iconSettings.getByText('自动 · 使用经典图标', { exact: true })
  await expect(iconSettings.getByTestId('app-icon-option-auto')).toHaveAccessibleName(
    '自动 · 使用经典图标'
  )
  await iconSettings.getByTestId('app-icon-option-ming').click()
  await expect(page.getByTestId('titlebar-brand-icon')).toHaveAttribute('src', /ming/)
  await autoIconLabel.click()
  await expect(page.getByTestId('titlebar-brand-icon')).toHaveAttribute('src', /app-icon-classic/)
  await expect(page.getByTestId('composer-fire-toggle')).toBeVisible()
})

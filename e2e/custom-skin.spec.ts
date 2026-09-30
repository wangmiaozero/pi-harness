import fs from 'node:fs'
import path from 'node:path'
import { test, expect } from './fixtures'

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
)

test('loads, selects, persists, and clears a declarative custom skin', async ({
  page,
  testUserData
}) => {
  const skinRoot = path.join(testUserData, 'custom-skins', 'e2e-skin')
  fs.mkdirSync(skinRoot, { recursive: true })
  fs.writeFileSync(path.join(skinRoot, 'preview.png'), ONE_PIXEL_PNG)
  fs.writeFileSync(
    path.join(skinRoot, 'pi-harness-skin.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        id: 'e2e-skin',
        name: 'E2E Custom Skin',
        version: '1.0.0',
        description: 'Declarative custom skin fixture',
        appearance: 'dark',
        assets: { preview: 'preview.png', wallpaper: 'preview.png' },
        tokens: { accent: '#123456', workspace: '#17202a' }
      },
      null,
      2
    )}\n`
  )

  await page.locator('a[href="#/settings"]').click()
  await page.getByTestId('settings-section-mascot').click()
  await page.getByTestId('mascot-unlock-answer').fill('1024')
  await page.getByRole('button', { name: /解锁|Unlock/, exact: true }).click()

  await expect(page.getByTestId('custom-skin-import')).toBeVisible()
  await expect(page.getByTestId('custom-skin-create-project')).toBeVisible()
  const option = page.locator('[data-custom-skin-option="e2e-skin"]')
  await expect(option).toBeVisible()
  await option.click()

  await expect
    .poll(() => page.evaluate(() => window.piSwitch.settings.get().then((s) => s.customSkinId)))
    .toBe('e2e-skin')
  await expect(page.locator('html')).toHaveAttribute('data-visual-skin', 'custom-e2e-skin')
  await expect(page.locator('html')).toHaveAttribute('data-custom-skin', 'true')
  expect(
    await page.evaluate(() => document.documentElement.style.getPropertyValue('--accent'))
  ).toBe('#123456')

  await page.locator('[data-mascot-option="none"]').click()
  await expect
    .poll(() => page.evaluate(() => window.piSwitch.settings.get().then((s) => s.customSkinId)))
    .toBeNull()
  await expect(page.locator('html')).not.toHaveAttribute('data-custom-skin', 'true')
})

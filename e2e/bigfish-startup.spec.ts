import { expect, test } from './fixtures'

test.use({ petPacks: true })

test('plays the bundled boot sequence when 大肥鱼 is enabled', async ({ page }) => {
  await page.evaluate(async () => {
    const settings = await window.piSwitch.settings.get()
    await window.piSwitch.settings.set({
      desktopPet: { ...settings.desktopPet, enabled: true, activePackId: 'bigfish' }
    })
  })
  await page.reload()

  await expect(page.locator('#dsh-startup-root')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('#dsh-startup-root')).toHaveCount(0)
  await expect(page.getByTestId('startup-animation')).toBeHidden({ timeout: 12_000 })
})

test('keeps the particle startup when the desktop pet is off', async ({ page }) => {
  await page.evaluate(async () => {
    const settings = await window.piSwitch.settings.get()
    await window.piSwitch.settings.set({
      desktopPet: { ...settings.desktopPet, enabled: false, activePackId: 'bigfish' }
    })
  })
  await page.reload()

  await expect(page.locator('#dsh-startup-root')).toHaveCount(0)
  await expect(page.getByTestId('startup-animation')).toContainText('检测')
  await expect(page.getByTestId('startup-animation')).toBeHidden({ timeout: 12_000 })

  await page.locator('a[href="#/settings/desktop-pet"]').click()
  const toggle = page.getByTestId('desktop-pet-section').getByRole('switch').first()
  if ((await toggle.count()) === 0) {
    await expect(page.getByTestId('pet-import-zip')).toBeVisible()
    return
  }
  await expect(toggle).toBeVisible()
  const alignment = await toggle.evaluate((element) => {
    const track = element.getBoundingClientRect()
    const thumb = element.querySelector('span')!.getBoundingClientRect()
    return {
      topGap: thumb.top - track.top,
      bottomGap: track.bottom - thumb.bottom,
      leftGap: thumb.left - track.left,
      rightGap: track.right - thumb.right
    }
  })
  expect(Math.abs(alignment.topGap - alignment.bottomGap)).toBeLessThan(1.5)
  expect(alignment.topGap).toBeGreaterThan(0)
  expect(alignment.leftGap).toBeGreaterThan(0)
  expect(alignment.rightGap).toBeGreaterThan(alignment.leftGap)
})

import fs from 'node:fs'
import path from 'node:path'
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

test('uses the short startup flow when the desktop pet is off', async ({ page }) => {
  await page.evaluate(async () => {
    const settings = await window.piSwitch.settings.get()
    await window.piSwitch.settings.set({
      desktopPet: { ...settings.desktopPet, enabled: false, activePackId: 'bigfish' }
    })
  })
  await page.reload()

  await expect(page.locator('#dsh-startup-root')).toHaveCount(0)
  const startup = page.getByTestId('startup-animation')
  await expect(startup).toHaveAttribute('data-startup-variant', 'none')
  await expect(startup).toHaveAttribute('data-flow-stage', 'lettering')
  await expect(startup).toBeHidden({ timeout: 12_000 })

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

test.describe('installed startup themes', () => {
  test.use({ themePacks: true })

  test('plays the theme-specific Claude welcome', async ({ page }) => {
    await page.evaluate(async () => {
      await window.piSwitch.settings.unlockMascot('1024')
      await window.piSwitch.settings.set({ mascotStyle: 'ropeClaude' })
    })
    await page.reload()
    const welcome = page.locator('#dsh-startup-root')
    await expect(welcome).toBeVisible()
    await expect(welcome).toContainText('CLAUDE')
    await expect(page.getByTestId('cinematic-flow-startup')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(welcome).toHaveCount(0)
  })

  test('plays the installed DeepSeek boot video in the legacy branch', async ({
    page,
    testUserData
  }) => {
    const startupAssets = path.join(
      testUserData,
      'market',
      'themes',
      'deepseek',
      'assets',
      'startup'
    )
    fs.mkdirSync(startupAssets, { recursive: true })
    fs.copyFileSync(
      path.join(import.meta.dirname, 'fixtures', 'startup-video.mp4'),
      path.join(startupAssets, 'boot.mp4')
    )
    await page.evaluate(async () => {
      await window.piSwitch.settings.unlockMascot('1024')
      await window.piSwitch.settings.set({ mascotStyle: 'deepseekPoster' })
    })
    await page.addInitScript(() => {
      Math.random = () => 0.25
    })
    await page.reload()
    const video = page.locator('.dsvs-boot-video')
    await expect(video).toHaveAttribute('data-shown', '1')
    expect(await video.evaluate((element: HTMLVideoElement) => element.videoWidth)).toBe(32)
    await expect(page.getByTestId('cinematic-flow-startup')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(video).toHaveCount(0)
  })
})

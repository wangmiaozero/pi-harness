import path from 'node:path'
import { test, expect } from './fixtures'

test('mascot gallery fills the page with equal-height previews across skins and window sizes', async ({
  page
}, testInfo) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.locator('a[href="#/settings"]').click()
  await page.getByTestId('settings-section-mascot').click()
  await page.getByTestId('mascot-unlock-answer').fill('1024')
  await page.getByRole('button', { name: /解锁|Unlock/, exact: true }).click()

  const gallery = page.getByTestId('mascot-settings-section')
  const grid = page.getByTestId('mascot-options-grid')
  const options = grid.locator('[data-mascot-option]')
  await expect(options).toHaveCount(10)
  await grid.locator('img').evaluateAll(async (images) => {
    await Promise.all(images.map((image) => (image as HTMLImageElement).decode()))
  })

  for (const [style, skin] of [
    ['noirScholar', 'noir-scholar'],
    ['moonlitMaid', 'moonlit-maid'],
    ['starshipCockpit', 'starship-cockpit'],
    ['none', 'default']
  ]) {
    const option = grid.locator(`[data-mascot-option="${style}"]`)
    await option.focus()
    await option.press('Space')
    await expect(option).toHaveAttribute('aria-pressed', 'true')
    await expect(grid.locator('[aria-pressed="true"]')).toHaveCount(1)
    await page.getByRole('button', { name: /保存|Save/, exact: true }).click()

    for (const [width, height, columns] of [
      [1920, 1080, 5],
      [1440, 900, 4],
      [1000, 780, 3],
      [760, 780, 2]
    ]) {
      await page.setViewportSize({ width, height })
      const galleryBox = (await gallery.boundingBox())!
      const pageBox = (await page.locator('.settings-view').boundingBox())!
      expect(galleryBox.x - pageBox.x).toBeCloseTo(24, 0)
      expect(pageBox.x + pageBox.width - galleryBox.x - galleryBox.width).toBeCloseTo(24, 0)

      const cards = await options.evaluateAll((elements) =>
        elements.map((element) => {
          const card = element.getBoundingClientRect()
          const preview = element.querySelector('.mascot-option-preview')!.getBoundingClientRect()
          const copy = element.querySelector('.mascot-option-copy')!.getBoundingClientRect()
          return {
            x: card.x,
            y: card.y,
            height: card.height,
            previewHeight: preview.height,
            copyHeight: copy.height,
            copyOffset: copy.y - card.y
          }
        })
      )
      expect(cards.filter((card) => Math.abs(card.y - cards[0].y) < 1)).toHaveLength(columns)
      for (const card of cards) {
        expect(card.previewHeight).toBe(208)
        expect(card.copyHeight).toBe(80)
        expect(card.height).toBeCloseTo(cards[0].height, 1)
        expect(card.copyOffset).toBeCloseTo(cards[0].copyOffset, 1)
      }
      expect(await gallery.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
        true
      )
      await expect(grid.locator('img').first()).toHaveCSS('object-fit', 'cover')
      await expect(grid.locator('img').first()).toHaveCSS('object-position', '50% 0%')
      await page.screenshot({
        path: path.join(
          process.env.PI_HARNESS_DESIGN_QA_DIR ?? testInfo.outputDir,
          `mascot-gallery-${skin}-${width}.png`
        )
      })
    }
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.reload()
    await expect(option).toHaveAttribute('aria-pressed', 'true')
  }

  // The wider gallery must not change the density of unrelated settings pages.
  await page.getByTestId('settings-back').click()
  await page.getByTestId('settings-section-general').click()
  const general = page.getByTestId('settings-back')
  await expect(general).toBeVisible()
  expect(
    await page
      .locator('.settings-view .max-w-\\[720px\\]')
      .evaluate((element) => element.getBoundingClientRect().width)
  ).toBe(720)
})

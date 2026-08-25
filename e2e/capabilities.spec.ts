import { test, expect } from './fixtures'

test.describe('Capabilities', () => {
  test('installs a featured skill through the trusted capability flow', async ({ page }) => {
    await page.locator('a[href="#/skills"]').click()
    const card = page.getByTestId('featured-capability-odai')
    await expect(card).toBeVisible()
    await expect(card).toContainText('Odai')
    await expect(card).toContainText(/未安装|Not installed/)

    await card.click()
    await page.getByTestId('featured-capability-install').click()
    await expect(card).toContainText(/已安装|Installed/, { timeout: 15_000 })

    const state = await page.evaluate(async () => {
      const [capabilities, skills] = await Promise.all([
        window.piSwitch.capabilities.list(),
        window.piSwitch.skills.refresh()
      ])
      return {
        capability: capabilities.find((entry) => entry.id === 'odai'),
        discovered: skills.some((skill) => skill.name === 'odai')
      }
    })
    expect(state.capability).toMatchObject({ installed: true, enabled: true, status: 'installed' })
    expect(state.discovered).toBe(true)
  })
})

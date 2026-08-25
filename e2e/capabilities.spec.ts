import { test, expect } from './fixtures'

test.describe('Capabilities', () => {
  test('shows and switches the selected capability view tab', async ({ page }) => {
    await page.locator('a[href="#/skills"]').click()

    const skillsTab = page.getByRole('tab', { name: /技能|Skills/, exact: true })
    const packagesTab = page.getByRole('tab', { name: /扩展包|Packages/, exact: true })
    const marketTab = page.getByRole('tab', { name: /市场|Market/, exact: true })

    await expect(skillsTab).toHaveAttribute('aria-selected', 'true')
    await expect(packagesTab).toHaveAttribute('aria-selected', 'false')

    const [selectedStyle, idleStyle] = await Promise.all([
      skillsTab.evaluate((element) => {
        const style = getComputedStyle(element)
        const labelStyle = getComputedStyle(element.querySelector('[data-tab-label]')!)
        return {
          backgroundColor: style.backgroundColor,
          color: labelStyle.color,
          boxShadow: style.boxShadow
        }
      }),
      packagesTab.evaluate((element) => {
        const style = getComputedStyle(element)
        const labelStyle = getComputedStyle(element.querySelector('[data-tab-label]')!)
        return {
          backgroundColor: style.backgroundColor,
          color: labelStyle.color,
          boxShadow: style.boxShadow
        }
      })
    ])
    expect(selectedStyle.backgroundColor).not.toBe(idleStyle.backgroundColor)
    expect(selectedStyle.color).not.toBe(idleStyle.color)
    expect(selectedStyle.boxShadow).not.toBe('none')

    await packagesTab.click()
    await expect(packagesTab).toHaveAttribute('aria-selected', 'true')
    await expect(skillsTab).toHaveAttribute('aria-selected', 'false')

    await marketTab.click()
    await expect(marketTab).toHaveAttribute('aria-selected', 'true')
    await expect(packagesTab).toHaveAttribute('aria-selected', 'false')
  })

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

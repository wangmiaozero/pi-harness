import path from 'node:path'
import { test, expect, type Page } from './fixtures'

async function dragSidebarToLimit(page: Page, delta: number): Promise<void> {
  const resizer = page.getByTestId('workspace-sidebar-resizer')
  const box = (await resizer.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(180, box.height / 2))
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + delta, box.y + Math.min(180, box.height / 2), {
    steps: 5
  })
  await page.mouse.up()
}

async function openMascotSettings(page: Page): Promise<void> {
  await page.locator('a[href="#/settings"]').click()
  await page.getByTestId('settings-section-mascot').click()
}

test('workspace project sidebar collapses and resizes within shared limits for every skin', async ({
  page
}, testInfo) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.locator('a[href="#/workspace"]').click()

  const sidebar = page.getByTestId('workspace-sidebar')
  const resizer = page.getByTestId('workspace-sidebar-resizer')
  const toggle = page.getByTestId('workspace-sidebar-toggle')

  await expect(sidebar).toBeVisible()
  await expect(resizer).toBeVisible()
  await expect(toggle).toBeVisible()
  expect((await sidebar.boundingBox())!.width).toBeCloseTo(260, 0)

  await dragSidebarToLimit(page, 1000)
  expect((await sidebar.boundingBox())!.width).toBe(480)
  await expect(resizer).toHaveAttribute('aria-valuenow', '480')

  await dragSidebarToLimit(page, -1000)
  expect((await sidebar.boundingBox())!.width).toBe(220)
  await expect(resizer).toHaveAttribute('aria-valuenow', '220')

  await toggle.click()
  await expect(sidebar).toBeHidden()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(resizer).toHaveAttribute('aria-disabled', 'true')
  await page.screenshot({ path: path.join(testInfo.outputDir, 'workspace-sidebar-collapsed.png') })

  await toggle.click()
  await expect(sidebar).toBeVisible()
  expect((await sidebar.boundingBox())!.width).toBe(220)

  await resizer.dblclick({ position: { x: 3, y: 120 } })
  expect((await sidebar.boundingBox())!.width).toBeCloseTo(260, 0)

  await resizer.focus()
  await page.keyboard.press('End')
  expect((await sidebar.boundingBox())!.width).toBe(480)
  await page.keyboard.press('Home')
  expect((await sidebar.boundingBox())!.width).toBe(220)

  await openMascotSettings(page)
  await page.getByTestId('mascot-unlock-answer').fill('1024')
  await page.getByRole('button', { name: /解锁|Unlock/, exact: true }).click()

  const sidebarMinimums = {
    none: 220,
    maidWhite: 220,
    office: 220,
    noirScholar: 220,
    moonlitMaid: 220,
    mingSnow: 390,
    zhangJuzhengSnow: 310,
    mingMoon: 390,
    starshipCockpit: 280
  } as const

  for (const style of [
    'none',
    'maidWhite',
    'office',
    'noirScholar',
    'moonlitMaid',
    'mingSnow',
    'zhangJuzhengSnow',
    'mingMoon',
    'starshipCockpit'
  ]) {
    await page.locator(`[data-mascot-option="${style}"]`).click()
    await page.locator('a[href="#/workspace"]').click()
    await expect(page.getByTestId('workspace-sidebar-resizer')).toBeVisible()
    await expect(page.getByTestId('workspace-sidebar-toggle')).toBeVisible()

    const themedSidebar = page.getByTestId('workspace-sidebar')
    const themedResizer = page.getByTestId('workspace-sidebar-resizer')
    const themedToggle = page.getByTestId('workspace-sidebar-toggle')
    const expectedMinimum = sidebarMinimums[style]
    await expect(themedResizer).toHaveAttribute('aria-valuemin', String(expectedMinimum))
    await themedResizer.focus()
    await page.keyboard.press('Home')
    expect((await themedSidebar.boundingBox())!.width).toBe(expectedMinimum)

    if (style === 'mingSnow' || style === 'mingMoon') {
      const statusScroll = page.getByTestId('ming-sidebar-scroll')
      await expect(statusScroll).toBeVisible()
      await themedToggle.click()
      await expect(statusScroll).toBeHidden()
      await themedToggle.click()
    }

    if (style === 'zhangJuzhengSnow') {
      await expect(page.locator('html')).toHaveAttribute('data-visual-skin', 'zhang-juzheng-snow')

      const zhangSidebar = themedSidebar
      const zhangResizer = themedResizer
      const zhangToggle = themedToggle
      const calligraphy = page.getByTestId('ming-workspace-calligraphy')
      const statusScroll = page.getByTestId('ming-sidebar-scroll')

      await page.screenshot({
        path: path.join(testInfo.outputDir, 'workspace-sidebar-zhang-juzheng-min.png')
      })

      const resizerBox = (await zhangResizer.boundingBox())!
      const toggleBox = (await zhangToggle.boundingBox())!
      expect(toggleBox.y + toggleBox.height / 2).toBeCloseTo(
        resizerBox.y + resizerBox.height / 2,
        0
      )

      await zhangResizer.focus()
      await page.keyboard.press('End')
      const maxSidebarBox = (await zhangSidebar.boundingBox())!
      const maxCalligraphyBox = (await calligraphy.boundingBox())!
      const maxStatusBox = (await statusScroll.boundingBox())!
      expect(maxSidebarBox.width).toBe(480)
      expect(maxCalligraphyBox.x).toBeCloseTo(maxSidebarBox.x + maxSidebarBox.width + 18, 0)
      expect(maxStatusBox.x + maxStatusBox.width / 2).toBeCloseTo(
        maxSidebarBox.x + maxSidebarBox.width / 2,
        0
      )

      await page.screenshot({
        path: path.join(testInfo.outputDir, 'workspace-sidebar-zhang-juzheng-max.png')
      })

      await zhangToggle.click()
      await expect(zhangSidebar).toBeHidden()
      await expect(statusScroll).toBeHidden()
      const collapsedCalligraphyBox = (await calligraphy.boundingBox())!
      expect(collapsedCalligraphyBox.x).toBeCloseTo(maxSidebarBox.x + 18, 0)
      await page.screenshot({
        path: path.join(testInfo.outputDir, 'workspace-sidebar-zhang-juzheng-collapsed.png')
      })
      await zhangToggle.click()
    }
    await openMascotSettings(page)
  }
})

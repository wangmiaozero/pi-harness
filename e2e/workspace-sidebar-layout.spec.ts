import path from 'node:path'
import { test, expect, type Page } from './fixtures'
import { APP_LANGUAGE_LABELS, type AppLocale } from '../src/shared/constants/language'

const workspaceLabels: Record<AppLocale, string> = {
  'en-US': 'Workspace',
  'zh-CN': '工作区',
  'zh-TW': '工作區',
  'ja-JP': 'ワークスペース',
  'ko-KR': '작업 영역',
  'ru-RU': 'Рабочая область',
  'fr-FR': 'Espace de travail',
  'de-DE': 'Arbeitsbereich'
}

async function expectSidebarLabelsToFit(page: Page): Promise<void> {
  const violations = await page.getByTestId('workspace-sidebar').evaluate((sidebar) => {
    const failures: string[] = []
    const sidebarBox = sidebar.getBoundingClientRect()
    const tabs = sidebar.querySelector<HTMLElement>('[data-testid="workspace-section-tabs"]')!
    if (tabs.scrollWidth > tabs.clientWidth + 1) failures.push('tabs overflow')
    const textRects = (element: Element) => {
      const range = document.createRange()
      range.selectNodeContents(element)
      return [...range.getClientRects()]
    }
    const buttons = [...tabs.querySelectorAll<HTMLButtonElement>('button')]
    for (const [index, button] of buttons.entries()) {
      const box = button.getBoundingClientRect()
      const label = button.querySelector('.workspace-section-label')!
      if (box.left < sidebarBox.left || box.right > sidebarBox.right)
        failures.push(`${button.textContent}: outside sidebar`)
      for (const rect of textRects(label)) {
        if (
          rect.left < box.left + 5 ||
          rect.right > box.right - 5 ||
          rect.top < box.top + 4 ||
          rect.bottom > box.bottom - 4
        )
          failures.push(`${button.textContent}: clipped or missing padding`)
      }
      for (const other of buttons.slice(index + 1)) {
        const otherBox = other.getBoundingClientRect()
        if (
          Math.min(box.right, otherBox.right) > Math.max(box.left, otherBox.left) + 1 &&
          Math.min(box.bottom, otherBox.bottom) > Math.max(box.top, otherBox.top) + 1
        )
          failures.push('overlapping tabs')
      }
    }
    const title = sidebar.querySelector('[data-testid="workspace-sidebar-title"] > span')!
    const header = title.closest('.mission-control-header')!.getBoundingClientRect()
    const actions = sidebar
      .querySelector('[data-testid="workspace-command-actions"]')!
      .getBoundingClientRect()
    if (actions.right > header.right || actions.left < header.left)
      failures.push('header actions overflow')
    for (const rect of textRects(title)) {
      if (
        rect.left < header.left ||
        rect.right > header.right ||
        rect.top < header.top ||
        rect.bottom > header.bottom
      )
        failures.push('header text overflow')
      if (
        rect.right > actions.left &&
        rect.left < actions.right &&
        rect.bottom > actions.top &&
        rect.top < actions.bottom
      )
        failures.push('header text overlaps actions')
    }
    return failures
  })
  expect(violations).toEqual([])
}

async function expectNavigationLabelsToFit(page: Page): Promise<void> {
  const violations = await page.getByTestId('app-navigation-rail').evaluate((rail) => {
    const failures: string[] = []
    for (const link of rail.querySelectorAll('a')) {
      const label = link.querySelector('[data-testid="app-navigation-label"]')!
      const box = link.getBoundingClientRect()
      const range = document.createRange()
      range.selectNodeContents(label)
      const rects = [...range.getClientRects()]
      if (rects.length !== 1) failures.push(`${label.textContent}: wraps`)
      for (const rect of rects) {
        if (rect.left < box.left + 2 || rect.right > box.right - 2)
          failures.push(`${label.textContent}: clipped or missing padding`)
      }
      if (!link.title || link.getAttribute('aria-label') !== link.title)
        failures.push(`${label.textContent}: missing full name`)
    }
    return failures
  })
  expect(violations).toEqual([])
}

for (const appearance of [
  { theme: 'macos27-light', mascotStyle: 'none' },
  { theme: 'light', mascotStyle: 'none' },
  { theme: 'dark', mascotStyle: 'none' },
  { theme: 'dark', mascotStyle: 'starshipCockpit' },
  { theme: 'dark', mascotStyle: 'mingMoon' },
  { theme: 'dark', mascotStyle: 'zhangJuzhengSnow' }
] as const) {
  test(`workspace labels fit every language: ${appearance.theme}/${appearance.mascotStyle}`, async ({
    page
  }, testInfo) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 1200, height: 780 })
    if (appearance.mascotStyle !== 'none')
      await page.evaluate(() => window.piSwitch.settings.unlockMascot('1024'))
    for (const language of Object.keys(APP_LANGUAGE_LABELS) as AppLocale[]) {
      await page.evaluate((settings) => window.piSwitch.settings.set(settings), {
        ...appearance,
        language
      })
      await page.reload()
      await expect(page.getByTestId('startup-animation')).toBeHidden({ timeout: 12_000 })
      await page.locator('a[href="#/workspace"]').click()
      await expectNavigationLabelsToFit(page)
      const tabs = page.getByTestId('workspace-section-tabs')
      await expect(tabs.getByTestId('workspace-section-workspace')).toHaveText(
        workspaceLabels[language]
      )
      await expect(tabs.getByRole('button')).toHaveCount(2)
      const resizer = page.getByTestId('workspace-sidebar-resizer')
      await resizer.dblclick({ position: { x: 3, y: 120 } })
      await expectSidebarLabelsToFit(page)
      await resizer.focus()
      await page.keyboard.press('Home')
      await expectSidebarLabelsToFit(page)
      if (['en-US', 'de-DE', 'fr-FR', 'ja-JP'].includes(language))
        await page.screenshot({
          path: path.join(testInfo.outputDir, `sidebar-${language}-narrow.png`)
        })
      for (const button of await tabs.getByRole('button').all()) {
        const radius = await button.evaluate((element) => getComputedStyle(element).borderRadius)
        await button.focus()
        await button.press('Enter')
        await expect(button).toHaveAttribute('aria-pressed', 'true')
        expect(await button.evaluate((element) => getComputedStyle(element).borderRadius)).toBe(
          radius
        )
      }
      await tabs.getByTestId('workspace-section-workspace').click()
      await resizer.focus()
      await page.keyboard.press('End')
      await expectSidebarLabelsToFit(page)
      await page.locator('a[href="#/ai-sessions"]').click()
      await expectNavigationLabelsToFit(page)
    }
  })
}

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
      const maxim = page.getByTestId('zhang-juzheng-maxim')
      const vow = page.getByTestId('zhang-juzheng-vow')
      const workspaceMain = page.getByTestId('workspace-main')
      const workspaceScene = page.getByTestId('workspace-scene')

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
      const maxMaximBox = (await maxim.boundingBox())!
      const maxVowBox = (await vow.boundingBox())!
      const maxMainBox = (await workspaceMain.boundingBox())!
      const maxSceneBox = (await workspaceScene.boundingBox())!
      const maxPortraitRight = maxSceneBox.x + Math.min(maxMainBox.width * 0.62, 820)
      expect(maxSidebarBox.width).toBe(480)
      expect(maxCalligraphyBox.x).toBeCloseTo(maxSidebarBox.x + maxSidebarBox.width + 18, 0)
      expect(maxStatusBox.x + maxStatusBox.width / 2).toBeCloseTo(
        maxSidebarBox.x + maxSidebarBox.width / 2,
        0
      )
      expect(maxMaximBox.x + maxMaximBox.width).toBeLessThanOrEqual(maxPortraitRight)
      expect(maxVowBox.x + maxVowBox.width).toBeLessThanOrEqual(maxPortraitRight)

      await page.screenshot({
        path: path.join(testInfo.outputDir, 'workspace-sidebar-zhang-juzheng-max.png')
      })

      await zhangToggle.click()
      await expect(zhangSidebar).toBeHidden()
      await expect(statusScroll).toBeHidden()
      const collapsedCalligraphyBox = (await calligraphy.boundingBox())!
      const collapsedMaximBox = (await maxim.boundingBox())!
      const collapsedVowBox = (await vow.boundingBox())!
      const collapsedMainBox = (await workspaceMain.boundingBox())!
      const collapsedSceneBox = (await workspaceScene.boundingBox())!
      const collapsedPortraitRight =
        collapsedSceneBox.x + Math.min(collapsedMainBox.width * 0.62, 820)
      expect(collapsedCalligraphyBox.x).toBeCloseTo(maxSidebarBox.x + 18, 0)
      expect(collapsedMaximBox.x + collapsedMaximBox.width).toBeLessThanOrEqual(
        collapsedPortraitRight
      )
      expect(collapsedVowBox.x + collapsedVowBox.width).toBeLessThanOrEqual(collapsedPortraitRight)
      expect(collapsedMaximBox.x).toBeLessThan(maxMaximBox.x)
      expect(collapsedVowBox.x).toBeLessThan(maxVowBox.x)
      await page.screenshot({
        path: path.join(testInfo.outputDir, 'workspace-sidebar-zhang-juzheng-collapsed.png')
      })
      await zhangToggle.click()
    }
    await openMascotSettings(page)
  }
})

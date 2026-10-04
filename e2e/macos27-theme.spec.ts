import path from 'node:path'
import { expect, test } from './fixtures'

test.describe('macOS 27 liquid glass themes', () => {
  test('renders dark and light optics without leaking into existing themes', async ({
    electronApp,
    page
  }) => {
    const consoleErrors: string[] = []
    const pageErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    page.on('pageerror', (error) => pageErrors.push(error.message))

    await expect(page.getByText('Pi-Harness').first()).toBeVisible({ timeout: 30_000 })
    await page.setViewportSize({ width: 1200, height: 780 })
    await page.locator('a[href="#/settings"]').click()
    await expect(page.locator('h1').filter({ hasText: /通用|General/ })).toBeVisible()

    const themeSelect = page.getByRole('button', { name: /主题|Theme/, exact: true })
    await themeSelect.click()
    await page.getByRole('option', { name: /macOS 27.*(?:深色|Dark)/, exact: true }).click()

    const root = page.locator('html')
    const titlebar = page.locator('.app-titlebar')
    const optics = page.getByTestId('macos27-optics-backdrop')
    const settingsCard = page.locator('.settings-view section').first()
    await expect(root).toHaveAttribute('data-theme', 'macos27')
    await expect(root).toHaveAttribute('data-appearance', 'dark')
    await expect
      .poll(() => electronApp.evaluate(({ nativeTheme }) => nativeTheme.themeSource))
      .toBe('dark')
    await expect
      .poll(() => titlebar.evaluate((element) => getComputedStyle(element).backgroundColor))
      .toBe('rgba(22, 18, 55, 0.42)')
    await expect
      .poll(() => titlebar.evaluate((element) => getComputedStyle(element).backdropFilter))
      .toContain('blur(20px)')
    await expect(optics).toBeVisible()
    await expect(optics).toHaveAttribute('data-background', 'liquid-ether')
    await expect
      .poll(() => optics.evaluate((element) => [element.clientWidth, element.clientHeight]))
      .toEqual([1200, 780])
    await expect
      .poll(() => settingsCard.evaluate((element) => getComputedStyle(element).backgroundColor))
      .toBe('rgba(35, 28, 78, 0.38)')
    await expect
      .poll(() => settingsCard.evaluate((element) => getComputedStyle(element).backdropFilter))
      .toContain('blur(14px)')

    await page.locator('a[href="#/skills"]').click()
    const capabilitiesTabs = page.locator('.capabilities-tabs')
    await expect
      .poll(() => capabilitiesTabs.evaluate((element) => getComputedStyle(element).backgroundColor))
      .toBe('rgba(22, 18, 55, 0.42)')
    await expect
      .poll(() => capabilitiesTabs.evaluate((element) => getComputedStyle(element).backdropFilter))
      .toContain('blur(20px)')

    const registrySearch = page.locator('.ui-search-field__input')
    await expect(registrySearch).toBeVisible()
    await expect
      .poll(() => registrySearch.evaluate((element) => getComputedStyle(element).backgroundColor))
      .toBe('rgba(0, 0, 0, 0)')
    if (process.env.PI_HARNESS_DESIGN_QA_DIR) {
      await page.screenshot({
        path: path.join(process.env.PI_HARNESS_DESIGN_QA_DIR, 'capabilities-macos27-dark.png'),
        fullPage: true
      })
    }

    await page.locator('a[href="#/workspace"]').click()
    const composerInput = page.getByTestId('composer-editor')
    await expect(composerInput).toBeVisible()
    await expect
      .poll(() =>
        composerInput.evaluate((element) => {
          const style = getComputedStyle(element)
          return [style.backgroundColor, style.boxShadow]
        })
      )
      .toEqual(['rgba(0, 0, 0, 0)', 'none'])
    if (process.env.PI_HARNESS_DESIGN_QA_DIR) {
      await page.screenshot({
        path: path.join(process.env.PI_HARNESS_DESIGN_QA_DIR, 'workspace-macos27-dark.png'),
        fullPage: true
      })

      await page.locator('a[href="#/git"]').click()
      await page.screenshot({
        path: path.join(process.env.PI_HARNESS_DESIGN_QA_DIR, 'git-macos27-dark.png'),
        fullPage: true
      })

      await page.locator('a[href="#/models"]').click()
      await page.screenshot({
        path: path.join(process.env.PI_HARNESS_DESIGN_QA_DIR, 'models-macos27-dark.png'),
        fullPage: true
      })
    }

    await page.locator('a[href="#/settings"]').click()
    await expect(page.locator('h1').filter({ hasText: /通用|General/ })).toBeVisible()

    const backgroundSelect = page.getByRole('button', {
      name: /macOS 27.*(?:背景|background)/i,
      exact: true
    })
    for (const option of [
      { name: /Lightfall/, value: 'lightfall' },
      { name: /Lightning/, value: 'lightning' },
      { name: /Web Threads/, value: 'web-threads' },
      { name: /Liquid Ether/, value: 'liquid-ether' }
    ]) {
      await backgroundSelect.click()
      await page.getByRole('option', { name: option.name }).click()
      await expect(optics).toHaveAttribute('data-background', option.value)
      if (process.env.PI_HARNESS_DESIGN_QA_DIR) {
        await page.screenshot({
          path: path.join(
            process.env.PI_HARNESS_DESIGN_QA_DIR,
            `settings-macos27-${option.value}.png`
          ),
          fullPage: true
        })
      }
    }

    await page
      .getByTestId('macos27-background-image-input')
      .setInputFiles(path.resolve('src/renderer/src/assets/themes/ming-dynasty/moon-city.png'))
    await expect(optics).toHaveAttribute('data-background', 'local-image')
    await expect(page.getByTestId('macos27-local-background-image')).toBeVisible()
    await expect(page.getByTestId('macos27-background-image-preview')).toBeVisible()
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const value = await window.piSwitch.settings.get()
          return {
            background: value.macos27Background,
            hasImage: value.macos27BackgroundImage?.startsWith('data:image/png;base64,') ?? false
          }
        })
      )
      .toEqual({ background: 'local-image', hasImage: true })

    if (process.env.PI_HARNESS_DESIGN_QA_DIR) {
      await page.screenshot({
        path: path.join(process.env.PI_HARNESS_DESIGN_QA_DIR, 'settings-macos27-local-image.png'),
        fullPage: true
      })
    }

    await page.getByTestId('macos27-background-image-clear').click()
    await expect(optics).toHaveAttribute('data-background', 'liquid-ether')
    await expect(page.getByTestId('macos27-local-background-image')).toHaveCount(0)

    if (process.env.PI_HARNESS_DESIGN_QA_DIR) {
      await page.screenshot({
        path: path.join(process.env.PI_HARNESS_DESIGN_QA_DIR, 'settings-macos27-dark.png'),
        fullPage: true
      })
    }

    await themeSelect.click()
    await page.getByRole('option', { name: /macOS 27.*(?:浅色|Light)/, exact: true }).click()

    await expect(root).toHaveAttribute('data-theme', 'macos27-light')
    await expect(root).toHaveAttribute('data-appearance', 'light')
    await expect
      .poll(() => electronApp.evaluate(({ nativeTheme }) => nativeTheme.themeSource))
      .toBe('light')
    await expect
      .poll(() => titlebar.evaluate((element) => getComputedStyle(element).backgroundColor))
      .toBe('rgba(248, 249, 255, 0.5)')
    await expect(optics).toBeVisible()
    await expect
      .poll(() => settingsCard.evaluate((element) => getComputedStyle(element).backgroundColor))
      .toBe('rgba(255, 255, 255, 0.48)')

    await page.locator('a[href="#/skills"]').click()
    await expect
      .poll(() => capabilitiesTabs.evaluate((element) => getComputedStyle(element).backgroundColor))
      .toBe('rgba(248, 249, 255, 0.5)')
    if (process.env.PI_HARNESS_DESIGN_QA_DIR) {
      await page.screenshot({
        path: path.join(process.env.PI_HARNESS_DESIGN_QA_DIR, 'capabilities-macos27-light.png'),
        fullPage: true
      })
    }
    await page.locator('a[href="#/settings"]').click()
    await expect(page.locator('h1').filter({ hasText: /通用|General/ })).toBeVisible()

    if (process.env.PI_HARNESS_DESIGN_QA_DIR) {
      await page.screenshot({
        path: path.join(process.env.PI_HARNESS_DESIGN_QA_DIR, 'settings-macos27-light.png'),
        fullPage: true
      })
    }

    await themeSelect.click()
    await page.getByRole('option', { name: /^(?:深色|Dark)$/ }).click()

    await expect(root).toHaveAttribute('data-theme', 'dark')
    await expect
      .poll(() => titlebar.evaluate((element) => getComputedStyle(element).backgroundColor))
      .toBe('rgb(24, 26, 29)')
    await expect
      .poll(() => titlebar.evaluate((element) => getComputedStyle(element).backdropFilter))
      .toBe('none')
    await expect(optics).toBeHidden()
    expect(consoleErrors).toEqual([])
    expect(pageErrors).toEqual([])
  })
})

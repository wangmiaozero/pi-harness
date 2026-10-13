import fs from 'node:fs'
import path from 'node:path'
import { test, expect } from './fixtures'
import { expectArchitectureDockToFit } from './architecture-controls'

test('architecture surfaces stay readable over scene skins and follow the active appearance', async ({
  page,
  electronApp,
  workspaceRoot
}, testInfo) => {
  test.setTimeout(210000)
  fs.writeFileSync(path.join(workspaceRoot, 'package.json'), '{"name":"glass-workspace"}')
  fs.writeFileSync(path.join(workspaceRoot, 'main.ts'), "import './service'\nexport const app = 1")
  fs.writeFileSync(path.join(workspaceRoot, 'service.ts'), 'export const service = 1')
  await page.locator('a[href="#/workspace"]').click()
  await electronApp.evaluate(({ dialog }, root) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] })
  }, workspaceRoot)
  await page.getByTestId('workspace-import-project').click()
  await page.getByTestId('workspace-architecture').click()
  await page.getByTestId('analyze-project').click()
  await expect(page.getByTestId('architecture-status')).toContainText(/complete|完成/, {
    timeout: 45000
  })
  await page.evaluate(() => window.piSwitch!.settings.unlockMascot('1024'))

  for (const [mascotStyle, theme, appearance] of [
    ['mingMoon', 'light', 'dark'],
    ['mingSnow', 'light', 'dark'],
    ['zhangJuzhengSnow', 'light', 'dark'],
    ['maidWhite', 'dark', 'light'],
    ['office', 'light', 'dark'],
    ['noirScholar', 'light', 'dark'],
    ['moonlitMaid', 'dark', 'light'],
    ['starshipCockpit', 'light', 'dark'],
    ['none', 'macos27-light', 'light'],
    ['none', 'macos27', 'dark'],
    ['none', 'light', 'light'],
    ['none', 'dark', 'dark']
  ] as const) {
    await page.evaluate((settings) => window.piSwitch!.settings.set(settings), {
      mascotStyle,
      theme
    })
    await page.reload()
    await expect(page.getByTestId('startup-animation')).toBeHidden({ timeout: 12000 })
    const portrait = page.getByTestId('portrait-skin-panel')
    const ornaments = page.locator('.ming-workspace-ornaments')
    if (mascotStyle !== 'none' && mascotStyle !== 'starshipCockpit')
      await expect(portrait).toBeVisible()
    if (mascotStyle.startsWith('ming') || mascotStyle === 'zhangJuzhengSnow')
      await expect(ornaments).toBeVisible()
    await page.getByTestId('workspace-architecture').click()
    await expect(portrait).toHaveCount(0)
    await expect(ornaments).toHaveCount(0)
    await expect(page.locator('html')).toHaveAttribute('data-appearance', appearance)
    await expect(page.getByTestId('architecture-viewer')).toBeVisible()
    await page.getByTestId('architecture-module').filter({ hasText: 'main.ts' }).click()
    const surfaces = [
      page.getByTestId('project-intelligence').locator('header'),
      page.locator('.architecture-analysisbar'),
      page.getByTestId('architecture-module-browser'),
      page.getByTestId('architecture-summary'),
      page.getByTestId('architecture-module-details')
    ]
    for (const surface of surfaces) {
      await expect(surface).toBeVisible()
      const paint = await surface.evaluate((element) => {
        const style = getComputedStyle(element)
        return { background: style.backgroundColor, filter: style.backdropFilter }
      })
      expect(paint.background).not.toMatch(/transparent|rgba\(0, 0, 0, 0\)/)
      expect(paint.filter).toContain('blur(24px)')
    }
    const nativeTheme = () =>
      electronApp.evaluate(async ({ webContents }) => {
        const view = webContents
          .getAllWebContents()
          .find((view) => view.getURL().startsWith('pi-architecture:'))
        if (!view) return null
        return view.executeJavaScript(`(()=>{
          const root=document.documentElement;
          const style=getComputedStyle(root);
          return {
            appearance:root.dataset.theme,
            background:getComputedStyle(document.querySelector('.diagram-container')).backgroundColor,
            accent:style.getPropertyValue('--pi-palette-accent').trim(),
            popupFilter:getComputedStyle(document.querySelector('.focus-chip')).backdropFilter,
            popupColor:getComputedStyle(document.querySelector('.focus-chip')).color
          };
        })()`)
      })
    await expect.poll(async () => (await nativeTheme())?.appearance).toBe(appearance)
    const palette = await nativeTheme()
    expect(palette.popupFilter).toContain('blur(20px)')
    if (mascotStyle === 'mingMoon') {
      expect(palette.background).toBe('rgb(25, 27, 30)')
      expect(palette.accent).toBe('#c96958')
      expect(palette.popupColor).toBe('rgb(244, 234, 221)')
    } else if (mascotStyle === 'zhangJuzhengSnow') {
      expect(palette.background).toBe('rgb(24, 20, 17)')
      expect(palette.accent).toBe('#b58a4a')
    } else if (mascotStyle === 'mingSnow') {
      expect(palette.background).toBe('rgb(32, 35, 38)')
    } else if (mascotStyle === 'maidWhite') {
      expect(palette.background).toBe('rgb(248, 251, 255)')
    }
    await page.getByTestId('architecture-close-details').click()
    await expectArchitectureDockToFit(electronApp)
    const screenshot = await electronApp.evaluate(async ({ webContents }) => {
      const view = webContents
        .getAllWebContents()
        .find((view) => view.getURL().startsWith('pi-architecture:'))!
      return (await view.capturePage()).toPNG().toString('base64')
    })
    fs.writeFileSync(
      testInfo.outputPath(`${mascotStyle}-${theme}-canvas.png`),
      Buffer.from(screenshot, 'base64')
    )
    await page.screenshot({ path: testInfo.outputPath(`${mascotStyle}-${theme}-chrome.png`) })
    await page.getByTestId('workspace-architecture').click()
    if (mascotStyle !== 'none' && mascotStyle !== 'starshipCockpit')
      await expect(portrait).toBeVisible()
    if (mascotStyle.startsWith('ming') || mascotStyle === 'zhangJuzhengSnow')
      await expect(ornaments).toBeVisible()
  }
})

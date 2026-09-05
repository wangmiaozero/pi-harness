import path from 'node:path'
import fs from 'node:fs'
import { test, expect, type Page } from './fixtures'

async function expectPersistedMascotStyle(page: Page, style: string) {
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.piSwitch.settings
          .get()
          .then((settings: { mascotStyle: string }) => settings.mascotStyle)
      )
    )
    .toBe(style)
}

test('maid and office use dedicated scenes and independent palettes', async ({
  page,
  electronApp
}, testInfo) => {
  await page.setViewportSize({ width: 1728, height: 1084 })
  await page.locator('a[href="#/settings"]').click()
  await page.getByTestId('settings-section-mascot').click()
  await page.getByTestId('mascot-unlock-answer').fill('1024')
  await page.getByRole('button', { name: /解锁|Unlock/, exact: true }).click()

  for (const theme of [
    {
      style: 'maidWhite',
      skin: 'maid-white',
      appearance: 'light',
      scene: 'azure-patisserie-atelier-v2',
      sprite: 'pico-maid-white'
    },
    {
      style: 'office',
      skin: 'office-executive',
      appearance: 'dark',
      scene: 'dusk-executive-suite-v2',
      sprite: 'pico-office'
    }
  ] as const) {
    await page.locator(`[data-mascot-option="${theme.style}"]`).click()
    await expectPersistedMascotStyle(page, theme.style)
    await expect(page.locator('html')).toHaveAttribute('data-visual-skin', theme.skin)
    await expect(page.locator('html')).toHaveAttribute('data-portrait-skin', 'true')
    await expect(page.locator('html')).toHaveAttribute('data-appearance', theme.appearance)
    await expect(
      page.locator(`[data-mascot-option="${theme.style}"] .mascot-option-preview`)
    ).toHaveCSS('background-image', new RegExp(theme.scene))
    await expect(page.getByTestId('app-shell')).toHaveCSS(
      'background-image',
      new RegExp(theme.scene)
    )

    await page.locator('a[href="#/workspace"]').click()
    if (await page.getByTestId('workspace-import-project').isVisible()) {
      await electronApp.evaluate(
        ({ dialog }, root) => {
          dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] })
        },
        path.resolve(import.meta.dirname, '../fixtures')
      )
      await page.getByTestId('workspace-import-project').click()
    }
    await expect(page.getByTestId('portrait-skin-panel')).toBeVisible()
    await expect(page.locator('.portrait-skin-heading')).toHaveCount(0)
    await expect(page.getByTestId('portrait-skin-image')).toHaveAttribute(
      'src',
      new RegExp(theme.sprite)
    )
    await expect(page.getByTestId('app-shell')).toHaveCSS(
      'background-image',
      new RegExp(theme.scene)
    )
    await page.screenshot({ path: path.join(testInfo.outputDir, `${theme.skin}.png`) })

    await page.locator('a[href="#/settings"]').click()
    await page.getByTestId('settings-section-mascot').click()
  }
})

test('switches original portrait skins, persists selection and restores plain themes', async ({
  page,
  electronApp,
  piAgentDir,
  workspaceRoot
}, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ width: 1728, height: 1084 })
  await page.locator('a[href="#/settings"]').click()
  await page.getByTestId('settings-section-mascot').click()
  await page.getByTestId('mascot-unlock-answer').fill('1024')
  await page.getByRole('button', { name: /解锁|Unlock/, exact: true }).click()

  for (const [style, id, appearance, filename] of [
    ['noirScholar', 'noir-scholar', 'dark', 'noir-scholar'],
    ['moonlitMaid', 'moonlit-maid', 'light', 'moonlit-maid']
  ] as const) {
    await page.locator(`[data-mascot-option="${style}"]`).click()
    await expectPersistedMascotStyle(page, style)
    await expect(page.locator('html')).toHaveAttribute('data-visual-skin', id)
    await expect(page.locator('html')).toHaveAttribute('data-appearance', appearance)
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-visual-skin', id)
    await expect(page.locator(`[data-mascot-option="${style}"]`)).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    if (style === 'noirScholar') {
      await expect(
        page.locator('[data-mascot-option="noirScholar"] .mascot-option-preview')
      ).toHaveCSS('background-image', /noir-study/)
      await expect(page.getByTestId('app-shell')).toHaveCSS('background-image', /noir-study/)
      await expect(page.locator('.starship-viewport-root')).toHaveCSS('backdrop-filter', /blur/)
      await expect(page.locator('.app-body')).toHaveCSS('background-image', 'none')
    } else {
      await expect(
        page.locator('[data-mascot-option="moonlitMaid"] .mascot-option-preview')
      ).toHaveCSS('background-image', /moonlit-tea-room/)
      await expect(page.getByTestId('app-shell')).toHaveCSS('background-image', /moonlit-tea-room/)
      await expect(page.locator('.app-body')).toHaveCSS('background-image', 'none')
      await expect(page.locator('.starship-viewport-root')).toHaveCSS(
        'background-color',
        'rgba(250, 247, 251, 0.62)'
      )
      await expect(page.locator('.starship-viewport-root')).toHaveCSS('backdrop-filter', /blur/)
    }

    await page.locator('a[href="#/workspace"]').click()
    await electronApp.evaluate(
      ({ dialog }, root) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] })
      },
      path.resolve(import.meta.dirname, '../fixtures')
    )
    await page.getByTestId('workspace-import-project').click()
    const panel = page.getByTestId('portrait-skin-panel')
    const image = page.getByTestId('portrait-skin-image')
    await expect(panel).toBeVisible()
    await expect(page.locator('.portrait-skin-heading')).toHaveCount(0)
    await expect(image).toHaveAttribute('src', new RegExp(filename))
    await expect(image).toHaveJSProperty('naturalWidth', 1024)
    await expect(image).toHaveJSProperty('naturalHeight', 1536)
    await expect(image).toHaveCSS('object-fit', 'contain')
    await expect(image).toHaveCSS('filter', 'none')
    await expect(image).toHaveCSS('mask-image', 'none')
    await expect(page.getByTestId('starship-cockpit-interior')).toHaveCount(0)
    await expect(page.getByTestId('workspace-mascot')).toHaveCount(0)
    const panelBox = await panel.boundingBox()
    const chatBox = await page.getByTestId('chat-window').boundingBox()
    {
      expect(panelBox!.x).toBeCloseTo(chatBox!.x, 0)
      const composer = page.getByTestId('chat-composer')
      const composerBox = (await composer.boundingBox())!
      const statusBox = (await page.getByTestId('chat-status-hud').boundingBox())!
      const sceneBox = (await page.getByTestId('workspace-scene').boundingBox())!
      expect(composerBox.x).toBeCloseTo(sceneBox.x, 0)
      expect(composerBox.width).toBeCloseTo(sceneBox.width, 0)
      expect(composerBox.y + composerBox.height).toBeCloseTo(statusBox.y, 0)
      expect(statusBox.y + statusBox.height).toBeCloseTo(sceneBox.y + sceneBox.height, 0)
      const bubbleBox = (await panel.getByTestId('pet-status-bubble').boundingBox())!
      const imageBox = (await image.boundingBox())!
      expect(bubbleBox.y + bubbleBox.height).toBeLessThan(imageBox.y)
      expect(imageBox.y + imageBox.height).toBeGreaterThan(composerBox.y)
      expect(bubbleBox.x + bubbleBox.width / 2).toBeCloseTo(imageBox.x + imageBox.width / 2, 0)
      for (const glass of [
        page.locator('.app-titlebar'),
        page.locator('.app-navigation-rail'),
        page.getByTestId('workspace-sidebar'),
        page.locator('.workspace-tabbar'),
        page.locator('.chat-status-hud'),
        composer
      ]) {
        await expect(glass).toHaveCSS('backdrop-filter', /blur\(20px\)/)
        await expect(glass).toHaveCSS(
          'background-color',
          style === 'noirScholar' ? 'rgba(30, 26, 22, 0.56)' : 'rgba(250, 247, 251, 0.5)'
        )
      }
      // Input controls must remain above the portrait, even where the two overlap.
      const textarea = composer.locator('textarea')
      await textarea.click({ position: { x: 12, y: 12 } })
      await textarea.fill('测试磨砂输入框')
      await expect(textarea).toBeFocused()
      await expect(textarea).toHaveValue('测试磨砂输入框')
      await textarea.fill('')
    }
    const scene = page.getByTestId('app-shell')
    await expect(scene).toHaveCSS('background-size', 'cover')
    await expect(panel).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(panel).toHaveCSS('background-image', 'none')
    if (style === 'noirScholar') {
      await expect(scene).toHaveCSS('background-image', /noir-study/)
    } else {
      await expect(scene).toHaveCSS('background-image', /moonlit-tea-room/)
      await expect(page.locator('.starship-viewport-root')).toHaveCSS(
        'background-color',
        'rgba(0, 0, 0, 0)'
      )
      await expect(page.getByTestId('workspace-sidebar')).toHaveCSS(
        'background-color',
        'rgba(250, 247, 251, 0.5)'
      )
      await expect(page.locator('.app-navigation-rail')).toHaveCSS(
        'background-color',
        'rgba(250, 247, 251, 0.5)'
      )
      await expect(image).toHaveCSS('object-position', '50% 100%')
    }
    const dimensions = await scene.evaluate(async (element) => {
      const source = getComputedStyle(element).backgroundImage.match(/url\("?([^"\)]+)"?\)/)?.[1]
      if (!source) throw new Error('Portrait background is missing')
      const background = new Image()
      background.src = source
      await background.decode()
      return [background.naturalWidth, background.naturalHeight]
    })
    expect(dimensions).toEqual([1672, 941])
    const saveScreenshot = path.join(
      process.env.PI_HARNESS_DESIGN_QA_DIR ?? testInfo.outputDir,
      `${id}.png`
    )
    await page.screenshot({ path: saveScreenshot })

    {
      const id = '01a026a4-0796-73ff-990a-a2be219835ad'
      const timestamp = '2026-08-30T05:00:00.000Z'
      const directory = path.join(
        piAgentDir,
        'sessions',
        `--${path
          .resolve(workspaceRoot)
          .replace(/^[/\\]/, '')
          .replace(/[/\\:]/g, '-')}--`
      )
      fs.mkdirSync(directory, { recursive: true })
      fs.writeFileSync(
        path.join(directory, `2026-08-30T05-00-00-000Z_${id}.jsonl`),
        [
          { type: 'session', version: 3, id, timestamp, cwd: workspaceRoot },
          {
            type: 'message',
            id: 'user-1',
            parentId: null,
            timestamp,
            message: {
              role: 'user',
              content: '检查主题的阅读效果',
              timestamp: Date.parse(timestamp)
            }
          },
          {
            type: 'message',
            id: 'assistant-1',
            parentId: 'user-1',
            timestamp,
            message: {
              role: 'assistant',
              content: [
                {
                  type: 'text',
                  text: `主题背景已就绪。\n\n- 人物与场景独立显示\n- 会话正文保持清晰\n- 文件面板随时可用\n\n\`\`\`ts\nconst theme = "${style}"\n\`\`\``
                }
              ],
              timestamp: Date.parse(timestamp)
            }
          }
        ]
          .map((entry) => JSON.stringify(entry))
          .join('\n') + '\n'
      )
      await page.getByTestId('workspace-refresh').click()
      await page
        .getByTestId(`session-row-${id}`)
        .getByRole('button', { name: '检查主题的阅读效果', exact: true })
        .click()
      const assistant = page.locator('[data-message-role="assistant"]')
      await expect(assistant).toContainText('主题背景已就绪')
      await expect(assistant).toHaveCSS(
        'background-color',
        style === 'noirScholar' ? 'rgba(21, 19, 16, 0.62)' : 'rgba(255, 253, 255, 0.6)'
      )
      {
        await expect(assistant).toHaveCSS('backdrop-filter', /blur\(16px\)/)
        const messageBox = (await assistant.boundingBox())!
        const imageBox = (await image.boundingBox())!
        expect(messageBox.x).toBeGreaterThan(imageBox.x + imageBox.width)
      }
      const statsToggle = page.getByTestId('chat-status-hud').locator('button[aria-expanded]')
      await expect(statsToggle).toBeVisible()
      await statsToggle.click()
      const sessionHud = page.locator('.session-hud')
      await expect(sessionHud).toBeVisible()
      const [composerBox, sessionBox, statusBox] = await Promise.all([
        page.getByTestId('chat-composer').boundingBox(),
        sessionHud.boundingBox(),
        page.getByTestId('chat-status-hud').boundingBox()
      ])
      expect(composerBox!.y + composerBox!.height).toBeCloseTo(sessionBox!.y, 0)
      expect(sessionBox!.y + sessionBox!.height).toBeCloseTo(statusBox!.y, 0)
      await statsToggle.click()
      await expect(sessionHud).toHaveCount(0)
      await page.screenshot({
        path: path.join(path.dirname(saveScreenshot), `${filename}-chat.png`)
      })
      {
        for (const viewport of [
          { width: 1200, height: 780 },
          { width: 1440, height: 900 },
          { width: 2560, height: 1440 }
        ]) {
          await page.setViewportSize(viewport)
          await expect(panel).toBeVisible()
          const sceneBox = (await page.getByTestId('workspace-scene').boundingBox())!
          const imageBox = (await image.boundingBox())!
          if (style === 'noirScholar') {
            const scale = Math.max(sceneBox.width / 1672, sceneBox.height / 941)
            const seatX = sceneBox.x + (sceneBox.width - 1672 * scale) / 2 + 1672 * scale * 0.235
            const seatY = sceneBox.y + (sceneBox.height - 941 * scale) / 2 + 941 * scale * 0.795
            expect(imageBox.x + imageBox.width * 0.58).toBeCloseTo(seatX, 0)
            expect(imageBox.y + imageBox.height * 0.54).toBeCloseTo(seatY, 0)
          } else {
            expect(imageBox.y + imageBox.height).toBeCloseTo(sceneBox.y + sceneBox.height - 14, 0)
            expect(imageBox.x).toBeGreaterThan(sceneBox.x)
          }
          const bubbleBox = (await panel.getByTestId('pet-status-bubble').boundingBox())!
          expect(bubbleBox.y + bubbleBox.height).toBeLessThan(imageBox.y)
          expect(bubbleBox.x + bubbleBox.width / 2).toBeCloseTo(imageBox.x + imageBox.width / 2, 0)
          const composerBox = (await page.getByTestId('chat-composer').boundingBox())!
          const statusBox = (await page.getByTestId('chat-status-hud').boundingBox())!
          expect(imageBox.y + imageBox.height).toBeGreaterThan(composerBox.y)
          expect(composerBox.x).toBeCloseTo(sceneBox.x, 0)
          expect(composerBox.width).toBeCloseTo(sceneBox.width, 0)
          expect(composerBox.y + composerBox.height).toBeCloseTo(statusBox.y, 0)
          expect(statusBox.y + statusBox.height).toBeCloseTo(sceneBox.y + sceneBox.height, 0)
          const messageBox = (await assistant.boundingBox())!
          expect(messageBox.x).toBeGreaterThan(imageBox.x + imageBox.width)
          await page.screenshot({
            path: path.join(path.dirname(saveScreenshot), `${filename}-${viewport.width}.png`)
          })
        }
        await page.setViewportSize({ width: 1728, height: 1084 })
      }
    }

    await page.getByTestId('workspace-toggle-files').click()
    await expect(panel).toHaveCount(0)
    await expect(page.getByTestId('workspace-files-panel')).toBeVisible()
    if (style === 'noirScholar') {
      await expect(scene).toHaveCSS('background-image', /noir-study/)
    } else {
      await expect(scene).toHaveCSS('background-image', /moonlit-tea-room/)
    }
    await page.getByTestId('workspace-toggle-files').click()
    await expect(panel).toBeVisible()
    await page.setViewportSize({ width: 1000, height: 780 })
    await expect(panel).toBeHidden()
    await expect(page.getByTestId('chat-composer')).toBeVisible()
    {
      const hudBox = (await page.locator('.chat-status-hud').boundingBox())!
      const chatBox = (await page.getByTestId('chat-window').boundingBox())!
      expect(hudBox.x).toBeCloseTo(chatBox.x, 0)
      const inset = await page
        .getByTestId('chat-scroller')
        .evaluate((element) => parseFloat(getComputedStyle(element).paddingLeft))
      expect(inset).toBeGreaterThanOrEqual(16)
      expect(inset).toBeLessThanOrEqual(32)
    }
    await page.setViewportSize({ width: 1728, height: 1084 })
    await page.locator('a[href="#/settings"]').click()
    await page.getByTestId('settings-section-mascot').click()
  }

  await page.locator('[data-mascot-option="starshipCockpit"]').click()
  await expectPersistedMascotStyle(page, 'starshipCockpit')
  await expect(page.locator('html')).toHaveAttribute('data-visual-skin', 'starship-cockpit')
  await expect(page.locator('.app-body')).toHaveCSS('background-image', 'none')
  await expect(page.getByTestId('app-shell')).not.toHaveCSS('background-image', /noir-study/)
  await page.locator('[data-mascot-option="none"]').click()
  await expectPersistedMascotStyle(page, 'none')
  await expect(page.locator('html')).not.toHaveAttribute('data-visual-skin')
  await expect(page.locator('.starship-viewport-root')).toHaveCSS('background-image', 'none')
  await expect(page.locator('.app-body')).toHaveCSS('background-image', 'none')
  await expect(page.getByTestId('app-shell')).toHaveCSS('background-image', 'none')
  const preferences = await page.evaluate(() => window.piSwitch.settings.get())
  await expect(page.locator('html')).toHaveAttribute('data-theme', preferences.theme)
  expect(errors).toEqual([])
})

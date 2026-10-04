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

test('scene portrait themes use dedicated backgrounds and palettes', async ({
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
    },
    {
      style: 'mingSnow',
      skin: 'ming-snow',
      appearance: 'dark',
      scene: 'snow-palace',
      sprite: 'snow-maiden'
    },
    {
      style: 'zhangJuzhengSnow',
      skin: 'zhang-juzheng-snow',
      appearance: 'dark',
      scene: 'snow-red-palace',
      sprite: 'zhang-juzheng'
    },
    {
      style: 'mingMoon',
      skin: 'ming-moon',
      appearance: 'dark',
      scene: 'moon-city',
      sprite: 'moon-maiden'
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

test('ming portrait themes render full figures beside parchment conversation surfaces', async ({
  page,
  electronApp,
  piAgentDir,
  workspaceRoot
}, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const id = '01a070f4-cc39-79f0-9666-6872c2c3b479'
  const timestamp = '2026-09-05T06:00:00.000Z'
  const directory = path.join(
    piAgentDir,
    'sessions',
    `--${workspaceRoot.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`
  )
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(
    path.join(directory, `2026-09-05T06-00-00-000Z_${id}.jsonl`),
    [
      { type: 'session', version: 3, id, timestamp, cwd: workspaceRoot },
      {
        type: 'custom_message',
        id: 'hidden-context',
        parentId: null,
        timestamp,
        customType: 'plan-mode-context',
        content: '',
        display: false
      },
      {
        type: 'message',
        id: 'user-1',
        parentId: 'hidden-context',
        timestamp,
        message: {
          role: 'user',
          content: '将风格切换界面升级为独立的古风卡片网格，并清理冗余代码。',
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
              text: '已完成界面梳理，人物、场景与会话内容保持独立。\n\n```ts\nconst theme = "ming-dynasty"\n```'
            },
            {
              type: 'toolCall',
              toolCallId: 'edit-1',
              toolName: 'edit',
              input: { edits: [{ oldText: '...', newText: '...' }] }
            }
          ],
          timestamp: Date.parse(timestamp)
        }
      }
    ]
      .map((entry) => JSON.stringify(entry))
      .join('\n') + '\n'
  )

  await page.setViewportSize({ width: 1677, height: 943 })
  await page.locator('a[href="#/settings"]').click()
  await page.getByTestId('settings-section-mascot').click()
  await page.getByTestId('mascot-unlock-answer').fill('1024')
  await page.getByRole('button', { name: /解锁|Unlock/, exact: true }).click()

  for (const [style, skin, paper, menuPaper] of [
    ['mingSnow', 'ming-snow', 'rgba(239, 222, 190, 0.96)', 'rgb(246, 232, 204)'],
    ['zhangJuzhengSnow', 'zhang-juzheng-snow', 'rgba(241, 223, 192, 0.97)', 'rgb(245, 232, 206)'],
    ['mingMoon', 'ming-moon', 'rgba(235, 214, 177, 0.96)', 'rgb(241, 223, 189)']
  ] as const) {
    await page.locator(`[data-mascot-option="${style}"]`).click()
    await page.locator('a[href="#/workspace"]').click()
    if (await page.getByTestId('workspace-import-project').isVisible()) {
      await electronApp.evaluate(({ dialog }, root) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] })
      }, workspaceRoot)
      await page.getByTestId('workspace-import-project').click()
    }
    await page.getByTestId('workspace-refresh').click()
    await page
      .getByTestId(`session-row-${id}`)
      .getByRole('button', { name: /将风格切换界面升级/, exact: true })
      .click()

    const image = page.getByTestId('portrait-skin-image')
    const user = page.locator('[data-message-role="user"]')
    const assistant = page.locator('[data-message-role="assistant"]')
    await expect(page.locator('[data-message-role="custom"]')).toHaveCount(0)
    await expect(page.locator('html')).toHaveAttribute('data-visual-skin', skin)
    if (skin === 'zhang-juzheng-snow') {
      await expect(page.getByTestId('zhang-titlebar-motto')).toBeVisible()
      await expect(page.getByTestId('zhang-titlebar-calligraphy-image')).toHaveAttribute(
        'src',
        /titlebar-calligraphy-overlay/
      )
      await expect(page.getByTestId('ming-titlebar-calligraphy')).toHaveCount(0)
      await expect(page.getByTestId('zhang-juzheng-maxim')).toBeVisible()
      await expect(page.getByTestId('zhang-juzheng-vow')).toBeVisible()
      await expect(page.getByTestId('zhang-edge-scroll-top')).toBeVisible()
      await expect(page.getByTestId('zhang-edge-scroll-bottom')).toBeVisible()
      await expect(page.getByTestId('zhang-snow-ornament-left')).toBeVisible()
      await expect(page.getByTestId('zhang-snow-ornament-right')).toBeVisible()
      await expect(page.getByTestId('zhang-calligraphy-scroll-image')).toHaveAttribute(
        'src',
        /calligraphy-scroll-spring/
      )
      await expect(page.getByTestId('zhang-edge-scroll-top-image')).toHaveAttribute(
        'src',
        /calligraphy-scroll-governance/
      )
      await expect(page.getByTestId('zhang-edge-scroll-bottom-image')).toHaveAttribute(
        'src',
        /calligraphy-scroll-minister/
      )
      await expect(page.getByTestId('zhang-wangwei-scroll-image')).toHaveAttribute(
        'src',
        /status-scroll-wangwei/
      )
      await expect(page.getByTestId('ming-workspace-calligraphy')).not.toContainText(
        '忽如一夜春风来'
      )
      await expect(page.getByTestId('zhang-edge-scroll-top')).not.toContainText('为天下计')
      await expect(page.getByTestId('zhang-edge-scroll-bottom')).not.toContainText('居庙堂之高')
      await expect(page.getByTestId('ming-sidebar-scroll')).not.toContainText('行到水穷处')
      await expect(page.getByTestId('zhang-titlebar-motto')).not.toContainText('北国风光')
      const titlebarBanner = await page
        .locator('.app-titlebar')
        .evaluate((element) => getComputedStyle(element, '::before').backgroundImage)
      expect(titlebarBanner).toMatch(/titlebar-snow-banner(?!-calligraphy)/)
      const titlebarCalligraphyBox = await page
        .getByTestId('zhang-titlebar-calligraphy-image')
        .boundingBox()
      expect(titlebarCalligraphyBox!.width / titlebarCalligraphyBox!.height).toBeGreaterThan(9)
    } else {
      await expect(page.getByTestId('ming-titlebar-calligraphy')).toBeVisible()
      await expect(page.getByTestId('zhang-titlebar-motto')).toHaveCount(0)
      await expect(page.getByTestId('zhang-juzheng-maxim')).toHaveCount(0)
    }
    if (process.platform !== 'win32') {
      await expect(page.getByTestId('titlebar-window-controls')).toBeVisible()
    }
    await expect(page.getByTestId('ming-shell-frame')).toBeVisible()
    await expect(page.getByTestId('ming-navigation-plum')).toBeVisible()
    await expect(page.getByTestId('ming-workspace-calligraphy')).toBeVisible()
    await expect(page.getByTestId('ming-sidebar-scroll')).toBeVisible()
    await expect(image).toHaveJSProperty('naturalWidth', 1024)
    await expect(image).toHaveJSProperty('naturalHeight', 1536)
    await expect(page.getByTestId('titlebar-brand-icon')).toHaveJSProperty('naturalWidth', 1024)
    if (process.platform !== 'win32') {
      await expect(page.getByTestId('titlebar-window-close')).toHaveCSS(
        'background-color',
        'rgb(255, 95, 87)'
      )
      await expect(page.getByTestId('titlebar-window-minimize')).toHaveCSS(
        'background-color',
        'rgb(254, 188, 46)'
      )
      await expect(page.getByTestId('titlebar-window-maximize')).toHaveCSS(
        'background-color',
        'rgb(40, 200, 64)'
      )
    }
    await expect(assistant).toHaveCSS('background-color', paper)
    await expect(assistant.locator('.tool-call-hud')).toHaveCSS(
      'background-color',
      skin === 'zhang-juzheng-snow' ? 'rgb(21, 20, 18)' : 'rgb(29, 29, 27)'
    )

    const [imageBox, userBox, assistantBox] = await Promise.all([
      image.boundingBox(),
      user.boundingBox(),
      assistant.boundingBox()
    ])
    expect(assistantBox!.x).toBeGreaterThan(imageBox!.x + imageBox!.width * 0.78)
    expect(userBox!.x).toBeCloseTo(assistantBox!.x, 0)
    expect(userBox!.width).toBeCloseTo(assistantBox!.width, 0)
    const brandBox = await page.getByTestId('titlebar-brand').boundingBox()
    expect(brandBox!.width).toBeGreaterThanOrEqual(312)
    if (process.platform !== 'win32') {
      const controlsBox = await page.getByTestId('titlebar-window-controls').boundingBox()
      expect(controlsBox!.x + controlsBox!.width).toBeLessThan(brandBox!.x)
    }
    await page.screenshot({
      path: path.join(testInfo.outputDir, `${skin}-titlebar-top-left.png`),
      clip: { x: 0, y: 0, width: 520, height: 70 }
    })
    const statsToggle = page.getByTestId('chat-status-hud').locator('button[aria-expanded]')
    await statsToggle.click()
    await expect(page.locator('.session-hud')).toBeVisible()
    await page.screenshot({ path: path.join(testInfo.outputDir, `${skin}-conversation.png`) })
    if (skin === 'ming-moon' && process.env.PI_HARNESS_DESIGN_QA_DIR) {
      await page.setViewportSize({ width: 2048, height: 1324 })
      await page.screenshot({
        path: path.join(process.env.PI_HARNESS_DESIGN_QA_DIR, 'ming-moon-message-alignment.png')
      })
      await page.setViewportSize({ width: 1677, height: 943 })
    }

    if (skin === 'zhang-juzheng-snow') {
      await page.setViewportSize({ width: 1677, height: 1084 })
      await expect(page.getByTestId('zhang-snow-ornament-left')).toHaveCSS('z-index', '22')
      await expect(page.getByTestId('zhang-snow-ornament-right')).toHaveCSS('z-index', '22')
      const treeViewport = page.locator(
        '.workspace-control-panel > .min-h-0.flex-1.overflow-y-auto'
      )
      const [treeViewportBox, sidebarScrollBox, leftOrnamentBox, sendButtonBox, rightOrnamentBox] =
        await Promise.all([
          treeViewport.boundingBox(),
          page.getByTestId('ming-sidebar-scroll').boundingBox(),
          page.getByTestId('zhang-snow-ornament-left').boundingBox(),
          page.locator('.command-execute-button').boundingBox(),
          page.getByTestId('zhang-snow-ornament-right').boundingBox()
        ])
      await expect(treeViewport).toHaveCSS('z-index', '19')
      expect(treeViewportBox!.y + treeViewportBox!.height).toBeLessThanOrEqual(
        sidebarScrollBox!.y + 1
      )
      expect(treeViewportBox!.y + treeViewportBox!.height).toBeLessThanOrEqual(leftOrnamentBox!.y)
      expect(sendButtonBox!.x + sendButtonBox!.width).toBeLessThanOrEqual(rightOrnamentBox!.x)
      await page.screenshot({
        path: path.join(testInfo.outputDir, `${skin}-layering-1677x1084.png`)
      })
      await page.setViewportSize({ width: 1677, height: 943 })
    }

    await page.getByTestId('workspace-section-workspace').click()
    await page.getByTestId('workspace-project-0').click({ button: 'right' })
    const projectMenu = page.getByTestId('project-context-menu')
    await expect(projectMenu).toBeVisible()
    await expect(projectMenu).toHaveCSS('background-color', menuPaper)
    await expect(projectMenu.getByRole('menuitem')).toHaveCount(10)
    await expect(projectMenu.getByRole('separator')).toHaveCount(2)
    await expect(projectMenu.getByTestId('project-context-action-pin')).toBeFocused()
    await projectMenu.getByTestId('project-context-action-edit').hover()
    await page.screenshot({
      path: path.join(testInfo.outputDir, `${skin}-project-context-menu.png`)
    })
    await page.keyboard.press('Escape')
    await expect(projectMenu).toHaveCount(0)

    const sessionRow = page.getByTestId(`session-row-${id}`)
    await sessionRow.click({ button: 'right' })
    const sessionMenu = page.getByTestId('session-context-menu')
    await expect(sessionMenu).toBeVisible()
    await expect(sessionMenu).toHaveCSS('background-color', menuPaper)
    await expect(sessionMenu.getByRole('menuitem')).toHaveCount(2)
    await expect(sessionMenu.getByTestId('session-context-action-rename')).toBeFocused()
    await sessionMenu.getByTestId('session-context-action-delete').hover()
    await page.screenshot({
      path: path.join(testInfo.outputDir, `${skin}-session-context-menu.png`)
    })
    await page.keyboard.press('Escape')
    await expect(sessionMenu).toHaveCount(0)

    await page.getByTestId('workspace-model-select').getByRole('button').click()
    const modelMenu = page.locator('.ui-select-menu')
    await expect(modelMenu.first()).toBeVisible()
    await expect(modelMenu.first()).toHaveCSS('background-color', menuPaper)
    await expect(page.locator('[data-select-cascade-group]').first()).toBeVisible()
    await expect(page.getByRole('listbox').locator('.ui-select-option').first()).toBeVisible()
    await page.locator('[data-select-cascade-group]').first().hover()
    await page.screenshot({ path: path.join(testInfo.outputDir, `${skin}-model-dropdown.png`) })
    await page.keyboard.press('Escape')
    await expect(modelMenu).toHaveCount(0)

    await page.getByTestId('workspace-section-harness').click()
    const harnessConsole = page.getByTestId('harness-console')
    await expect(harnessConsole).toBeVisible()
    await expect(page.getByTestId('portrait-skin-panel')).toHaveCount(0)
    await expect(page.getByTestId('workspace-tabs')).toHaveCount(0)
    await expect(page.getByTestId('workspace-toggle-files')).toHaveCount(0)
    const [workspaceMainBox, harnessConsoleBox] = await Promise.all([
      page.getByTestId('workspace-main').boundingBox(),
      harnessConsole.boundingBox()
    ])
    expect(harnessConsoleBox).toEqual(workspaceMainBox)
    await page.screenshot({ path: path.join(testInfo.outputDir, `${skin}-harness-mode.png`) })
    await page.getByTestId('workspace-section-workspace').click()
    await expect(image).toBeVisible()
    await expect(assistant).toBeVisible()

    await page.setViewportSize({ width: 1200, height: 780 })
    await expect(page.getByTestId('portrait-skin-panel')).toBeVisible()
    await expect(assistant).toBeVisible()
    if (skin === 'zhang-juzheng-snow') {
      await expect(page.getByTestId('zhang-titlebar-motto')).toBeVisible()
      await expect(page.getByTestId('zhang-titlebar-calligraphy-image')).toBeVisible()
      await expect(page.getByTestId('zhang-titlebar-motto').locator('span')).toBeHidden()
      await expect(page.getByTestId('zhang-juzheng-maxim')).toBeHidden()
      await expect(page.getByTestId('zhang-juzheng-vow')).toBeHidden()
      await expect(page.getByTestId('zhang-edge-scroll-top')).toBeHidden()
      await expect(page.getByTestId('zhang-edge-scroll-bottom')).toBeHidden()
      const responsiveTitlebarBanner = await page
        .locator('.app-titlebar')
        .evaluate((element) => getComputedStyle(element, '::before').backgroundImage)
      expect(responsiveTitlebarBanner).toMatch(/titlebar-snow-banner(?!-calligraphy)/)
      await expect(page.locator('.command-console-controls')).toHaveCSS('flex-wrap', 'nowrap')
      await expect(page.locator('.command-console-controls')).toHaveCSS('padding-right', '0px')
      const [modelBox, toolStripBox, sendButtonBox] = await Promise.all([
        page.getByTestId('workspace-model-select').boundingBox(),
        page.locator('.console-tool-strip').boundingBox(),
        page.locator('.command-execute-button').boundingBox()
      ])
      expect(Math.abs(modelBox!.y - toolStripBox!.y)).toBeLessThan(4)
      expect(Math.abs(modelBox!.y - sendButtonBox!.y)).toBeLessThan(4)
      await page.screenshot({
        path: path.join(testInfo.outputDir, `${skin}-responsive-1200x780.png`)
      })
    } else {
      await expect(page.getByTestId('ming-titlebar-calligraphy')).toBeVisible()
    }
    await expect(page.getByTestId('ming-workspace-calligraphy')).toBeVisible()
    await expect(page.getByTestId('ming-sidebar-scroll')).toBeVisible()
    if (skin === 'zhang-juzheng-snow') {
      await page.setViewportSize({ width: 960, height: 640 })
      await expect(page.getByTestId('zhang-titlebar-calligraphy-image')).toBeVisible()
      const [controlsBox, modelBox, toolStripBox, sendButtonBox] = await Promise.all([
        page.locator('.command-console-controls').boundingBox(),
        page.getByTestId('workspace-model-select').boundingBox(),
        page.locator('.console-tool-strip').boundingBox(),
        page.locator('.command-execute-button').boundingBox()
      ])
      expect(Math.abs(modelBox!.y - toolStripBox!.y)).toBeLessThan(4)
      expect(Math.abs(modelBox!.y - sendButtonBox!.y)).toBeLessThan(4)
      expect(sendButtonBox!.x + sendButtonBox!.width).toBeLessThanOrEqual(
        controlsBox!.x + controlsBox!.width
      )
      await page.screenshot({
        path: path.join(testInfo.outputDir, `${skin}-minimum-960x640.png`)
      })
    }
    await page.setViewportSize({ width: 1677, height: 943 })

    await page.locator('a[href="#/settings"]').click()
    await page.getByTestId('settings-section-mascot').click()
  }

  expect(errors).toEqual([])
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
      const editor = composer.getByTestId('composer-editor')
      await editor.click({ position: { x: 12, y: 12 } })
      await editor.pressSequentially('测试磨砂输入框')
      await expect(editor).toBeFocused()
      await expect(editor).toHaveText('测试磨砂输入框')
      await editor.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
      await editor.press('Backspace')
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

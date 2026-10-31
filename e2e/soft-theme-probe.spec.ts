import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { _electron as electron } from '@playwright/test'
import { expect, test as base } from './fixtures'
import { APP_THEMES, themeAppearance, type AppTheme } from '../src/shared/constants/theme'
import { seedWorkspaceSession } from './workspace-fixtures'

const sessionId = 'calm-theme-fixture'
const accents: Record<AppTheme, string> = {
  dark: '#91a9c7',
  'soft-dark': '#aaa6c2',
  light: '#626b7b',
  'soft-light': '#8351dc',
  pink: '#b94c7b',
  purple: '#7955bd',
  green: '#537b61',
  blue: '#4c719c',
  orange: '#a5612c',
  red: '#b65359',
  cyan: '#337e80',
  'macos27-light': '#4c719c',
  macos27: '#86a7cb'
}
const test = base.extend<{ savedTheme: AppTheme }>({
  savedTheme: ['soft-light', { option: true }],
  piAgentDir: async ({ testUserData, workspaceRoot, savedTheme }, use) => {
    const agentDir = path.join(testUserData, 'mock-pi')
    fs.cpSync(path.resolve('fixtures/mock-pi'), agentDir, { recursive: true })
    fs.writeFileSync(
      path.join(testUserData, 'settings.json'),
      JSON.stringify({ theme: savedTheme, language: 'zh-CN', composerFireEnabled: false })
    )
    seedWorkspaceSession(agentDir, workspaceRoot, sessionId, '请检查界面中的文本与代码。')
    const sessionDir = fs.readdirSync(path.join(agentDir, 'sessions'))[0]!
    const sessionFile = fs.readdirSync(path.join(agentDir, 'sessions', sessionDir))[0]!
    fs.appendFileSync(
      path.join(agentDir, 'sessions', sessionDir, sessionFile),
      JSON.stringify({
        type: 'message',
        id: 'calm-assistant',
        parentId: '01a026a4-0796-73ff-990a-a2be2198353d',
        timestamp: '2026-08-29T05:00:01.000Z',
        message: {
          role: 'assistant',
          model: 'fixture',
          provider: 'fixture',
          stopReason: 'stop',
          content: [
            {
              type: 'text',
              text: '主题已准备就绪。\n\n```ts\nconst message = "Hello, Pi"\n```\n\n- 柔和的背景\n- 清晰的交互状态'
            }
          ]
        }
      }) + '\n'
    )
    await use(agentDir)
  }
})

for (const value of APP_THEMES) {
  test.describe(value, () => {
    test.use({ savedTheme: value })
    test('switches, persists and renders the workspace and settings', async ({
      page,
      electronApp,
      testUserData,
      workspaceRoot
    }, testInfo) => {
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.setViewportSize({ width: 1440, height: 900 })
      const root = page.locator('html')
      // The fresh Electron process must load the saved ID, including native appearance.
      await expect(root).toHaveAttribute('data-theme', value)
      await expect
        .poll(() => electronApp.evaluate(({ nativeTheme }) => nativeTheme.themeSource))
        .toBe(themeAppearance(value))
      await page.locator('a[href="#/settings"]').click()
      const picker = page.getByRole('button', { name: /主题|Theme/, exact: true })
      // Exercise a real change and change back via the existing persisted picker.
      for (const target of [
        APP_THEMES[(APP_THEMES.indexOf(value) + 1) % APP_THEMES.length]!,
        value
      ]) {
        await picker.click()
        await expect(page.getByRole('option')).toHaveCount(13)
        await page.getByRole('option').nth(APP_THEMES.indexOf(target)).click()
        await expect(root).toHaveAttribute('data-theme', target)
        await expect(root).toHaveAttribute('data-appearance', themeAppearance(target))
      }
      await expect
        .poll(
          () => JSON.parse(fs.readFileSync(path.join(testUserData, 'settings.json'), 'utf8')).theme
        )
        .toBe(value)
      await page.reload()
      await expect(page.getByTestId('startup-animation')).toBeHidden({ timeout: 12_000 })
      await expect(root).toHaveAttribute('data-theme', value)
      await expect(picker).toHaveCSS('height', '34px')
      await expect(picker).toHaveCSS('border-top-left-radius', '10px')
      await expect(page.getByTestId('user-name-input')).toHaveCSS('height', '34px')
      const qaDir = process.env.PI_HARNESS_DESIGN_QA_DIR ?? testInfo.outputDir
      fs.mkdirSync(qaDir, { recursive: true })
      await page.screenshot({ path: path.join(qaDir, `theme-${value}-settings.png`) })
      await page.evaluate(
        ({ sessionId, workspaceRoot }) => {
          localStorage.setItem(
            'pi-harness.workspace.v1',
            JSON.stringify({
              projectKey: null,
              pickedCwd: null,
              projectRoots: [],
              tabs: [
                {
                  id: `chat:${sessionId}`,
                  kind: 'chat',
                  title: 'Theme preview',
                  sessionId,
                  closable: false
                }
              ],
              activeTabId: `chat:${sessionId}`
            })
          )
          return window.piSwitch.workspace.allowRoot(workspaceRoot)
        },
        { sessionId, workspaceRoot }
      )
      await page.locator('a[href="#/workspace"]').click()
      const composer = page.getByTestId('chat-composer')
      const editor = page.getByTestId('composer-editor')
      await expect(editor).toBeVisible()
      await expect(page.locator('.assistant-message-body')).toBeVisible()
      await expect(composer.locator('.command-console-input')).toHaveCSS(
        'border-top-left-radius',
        '28px'
      )
      await expect(composer.locator('.command-execute-button')).toHaveCSS('width', '42px')
      await page.screenshot({ path: path.join(qaDir, `theme-${value}-workspace.png`) })
      await composer.screenshot({ path: path.join(qaDir, `theme-${value}-composer.png`) })
      await editor.fill('请检查主题')
      await expect(composer.locator('.command-execute-button')).toBeEnabled()
      // Resolve CSS colors in Chromium (including color-mix) before contrast checks.
      const colors = await composer.evaluate((element) => {
        const probe = document.createElement('span')
        element.append(probe)
        const resolve = (value: string) => {
          probe.style.color = value
          const canvas = document.createElement('canvas')
          canvas.width = canvas.height = 1
          const context = canvas.getContext('2d')!
          // Glass text is translucent: composite it before measuring contrast.
          context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(
            '--bg-window'
          )
          context.fillRect(0, 0, 1, 1)
          context.fillStyle = getComputedStyle(probe).color
          context.fillRect(0, 0, 1, 1)
          return Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3)
        }
        const result = {
          foreground: resolve('var(--text-primary)'),
          secondary: resolve('var(--text-secondary)'),
          background: resolve('var(--bg-window)'),
          accent: resolve('var(--accent)'),
          button: resolve('var(--accent-solid)'),
          white: [255, 255, 255]
        }
        probe.remove()
        return result
      })
      const luminance = (rgb: number[]) =>
        rgb
          .map((v) => {
            const n = v / 255
            return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4
          })
          .reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i]!, 0)
      const contrast = (a: number[], b: number[]) => {
        const x = luminance(a),
          y = luminance(b)
        return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
      }
      expect('#' + colors.accent.map((c) => c.toString(16).padStart(2, '0')).join('')).toBe(
        accents[value]
      )
      expect(contrast(colors.foreground, colors.background)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(colors.secondary, colors.background)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(colors.white, colors.button)).toBeGreaterThanOrEqual(4.5)
      if (['pink', 'purple', 'green', 'blue', 'orange', 'red', 'cyan'].includes(value)) {
        expect(Math.max(...colors.background) - Math.min(...colors.background)).toBeLessThan(5)
      }
      await page.getByTestId('composer-more').click()
      await expect(page.getByTestId('composer-compact')).toHaveCount(0)
      await expect(page.getByTestId('composer-sound-toggle')).toBeVisible()
      await page.keyboard.press('Escape')
      await page.setViewportSize({ width: 960, height: 700 })
      await expect(composer.locator('.command-execute-button')).toBeInViewport()
      const overflow = await composer.evaluate(
        (element) => element.scrollWidth - element.clientWidth
      )
      expect(overflow).toBeLessThanOrEqual(1)
      const clipped = await composer.locator('.command-console-input').evaluate((element) => {
        const shell = element.getBoundingClientRect()
        return [...element.querySelectorAll('button')]
          .filter((button) => {
            const box = button.getBoundingClientRect()
            return (
              box.width > 0 &&
              (box.left < shell.left || box.right > shell.right || box.bottom > shell.bottom)
            )
          })
          .map((button) => button.getAttribute('aria-label'))
      })
      expect(clipped).toEqual([])
      await composer.getByRole('button', { name: '权限模式', exact: true }).click()
      const permissions = page.getByRole('listbox', { name: '权限模式' })
      await expect(permissions).toBeInViewport()
      await expect(permissions.getByRole('option')).toHaveCount(3)
      await permissions.screenshot({ path: path.join(qaDir, `theme-${value}-permissions.png`) })
      await page.keyboard.press('Escape')
      await editor.fill(Array.from({ length: 40 }, (_, i) => `Line ${i}`).join('\n'))
      await expect
        .poll(() =>
          composer
            .locator('.composer-text-area')
            .evaluate((element) => element.scrollHeight > element.clientHeight)
        )
        .toBe(true)
      await expect(composer.locator('.command-execute-button')).toBeInViewport()
      await page.screenshot({ path: path.join(qaDir, `theme-${value}-narrow.png`) })
      expect(errors).toEqual([])
    })
  })
}

base('keeps focus, placeholders and glass legible with reduced effects', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 780 })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'prefers-reduced-motion', value: 'reduce' },
      { name: 'prefers-reduced-transparency', value: 'reduce' }
    ]
  })
  await page.locator('a[href="#/workspace"]').click()
  const composer = page.getByTestId('chat-composer')
  const editor = page.getByTestId('composer-editor')
  await editor.focus()
  await expect(editor).toBeFocused()
  const placeholder = await editor.evaluate((element) => {
    const style = getComputedStyle(element, '::before')
    const text = element.getAttribute('data-placeholder')!
    const context = document.createElement('canvas').getContext('2d')!
    context.font = style.font
    return {
      content: style.content,
      text,
      width: parseFloat(style.width),
      textWidth: context.measureText(text).width,
      color: style.color
    }
  })
  expect(placeholder.text.length).toBeGreaterThan(2)
  expect(placeholder.content).toBe(JSON.stringify(placeholder.text))
  // Font fallback differs across operating systems; the full text must still fit.
  expect(placeholder.width).toBeGreaterThan(0)
  expect(Math.abs(placeholder.width - placeholder.textWidth)).toBeLessThan(1)
  expect(placeholder.color).not.toBe('rgba(0, 0, 0, 0)')
  await expect(composer.locator('.command-console-input')).not.toHaveCSS('box-shadow', 'none')
  await page.locator('a[href="#/settings"]').click()
  const picker = page.getByRole('button', { name: /主题|Theme/, exact: true })
  for (const theme of ['macos27', 'macos27-light'] as const) {
    await picker.click()
    await page.getByRole('option').nth(APP_THEMES.indexOf(theme)).click()
    await expect(page.locator('.app-titlebar')).toHaveCSS('backdrop-filter', 'none')
    await expect(page.locator('.settings-view section').first()).toHaveCSS(
      'backdrop-filter',
      'none'
    )
    const background = await page
      .locator('.settings-view section')
      .first()
      .evaluate((element) => getComputedStyle(element).backgroundColor)
    expect(background).toMatch(/^rgb\(/)
    const motion = await picker.evaluate((element) => getComputedStyle(element).transitionDuration)
    expect(motion).toBe('0s')
  }
  await cdp.detach()
})

base(
  'restores the saved theme after a full Electron restart',
  async ({ page, electronApp, testUserData, piAgentDir }) => {
    let currentApp = electronApp
    let currentPage = page
    try {
      for (const theme of ['purple', 'soft-dark'] as const) {
        await currentPage.locator('a[href="#/settings"]').click()
        await currentPage.getByRole('button', { name: /主题|Theme/, exact: true }).click()
        await currentPage.getByRole('option').nth(APP_THEMES.indexOf(theme)).click()
        await expect
          .poll(
            () =>
              JSON.parse(fs.readFileSync(path.join(testUserData, 'settings.json'), 'utf8')).theme
          )
          .toBe(theme)
        await currentApp.close()
        currentApp = await electron.launch({
          executablePath: createRequire(import.meta.url)('electron') as string,
          args: [path.resolve('out/main/index.js')],
          env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: undefined,
            PI_HARNESS_AGENT_MODE: 'sdk',
            PI_HARNESS_USER_DATA: testUserData,
            PI_HARNESS_PI_CLI_PATH: path.join(testUserData, 'missing-pi-cli'),
            PI_HARNESS_PI_CONFIG_DIR: piAgentDir,
            PI_CODING_AGENT_DIR: piAgentDir,
            PI_HARNESS_SESSION_HOME: path.join(testUserData, 'history-home'),
            PI_HARNESS_CAPABILITY_FIXTURES_DIR: path.resolve('fixtures/capabilities'),
            PI_HARNESS_BUILTIN_SKILLS_DIR: path.resolve('resources/builtin-skills')
          }
        })
        await expect
          .poll(() =>
            currentApp.windows().some((window) => window.url().includes('/renderer/index.html'))
          )
          .toBe(true)
        currentPage = currentApp
          .windows()
          .find((window) => window.url().includes('/renderer/index.html'))!
        await expect(currentPage.getByTestId('startup-animation')).toBeHidden({ timeout: 12_000 })
        await expect(currentPage.locator('html')).toHaveAttribute('data-theme', theme)
        await expect(currentPage.locator('html')).toHaveAttribute(
          'data-appearance',
          themeAppearance(theme)
        )
        expect(await currentApp.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe(
          themeAppearance(theme)
        )
      }
    } finally {
      await currentApp.close().catch(() => undefined)
    }
  }
)

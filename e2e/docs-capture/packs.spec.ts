import fs from 'node:fs'
import path from 'node:path'
import { test as base, expect } from '../fixtures'
import type { ElectronApplication, Page } from '@playwright/test'
import { IPC_INVOKE } from '../../src/shared/ipc/channels'
import { openOverflowPage } from '../navigation'
import {
  AURORA,
  VIEWPORT,
  ensureAuroraWorkspace,
  openSession,
  seedConversation,
  shot,
  writeProfileSettings
} from './helpers'

const sessionId = 'docs-demo-workspace'
const packagesRoot = '/Users/tree/codes/my-codes/pi-Harness-packages'
const themePacks = [
  'maid-white',
  'office',
  'starship',
  'noir-scholar',
  'moonlit-maid',
  'ming-snow',
  'zhang-juzheng',
  'ming-moon'
] as const

type CaptureSkin = 'mingSnow' | 'zhangJuzhengSnow' | 'mingMoon' | 'starshipCockpit' | 'none'

function installThemePacks(testUserData: string) {
  const marketRoot = path.join(testUserData, 'market')
  const themes: Record<string, unknown> = {}
  for (const directory of themePacks) {
    const source = path.join(packagesRoot, `theme-${directory}`)
    const manifest = JSON.parse(
      fs.readFileSync(path.join(source, 'theme-pack.json'), 'utf8')
    ) as { id: string; version: string; license: string }
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(source, 'package.json'), 'utf8')
    ) as { name: string; version: string }
    fs.cpSync(source, path.join(marketRoot, 'themes', manifest.id), {
      recursive: true,
      verbatimSymlinks: false
    })
    themes[manifest.id] = {
      name: packageJson.name,
      version: packageJson.version,
      sha256: '0'.repeat(64),
      packId: manifest.id,
      license: manifest.license
    }
  }
  fs.mkdirSync(marketRoot, { recursive: true })
  fs.writeFileSync(
    path.join(marketRoot, 'index.json'),
    JSON.stringify({ schemaVersion: 1, themes, pets: {}, addons: {} }, null, 2)
  )
}

const test = base.extend({
  piAgentDir: async ({ testUserData }, use) => {
    const agentDir = path.join(testUserData, 'mock-pi')
    fs.cpSync(path.resolve('fixtures/mock-pi'), agentDir, { recursive: true })
    installThemePacks(testUserData)
    writeProfileSettings(testUserData, {
      mascotUnlocked: true,
      mascotStyle: 'none',
      petAnimations: false,
      petStatusText: false
    })
    ensureAuroraWorkspace()
    seedConversation(agentDir, AURORA, sessionId, [
      {
        role: 'user',
        text: 'Design a clean, comfortable desktop workspace. Keep conversations, project files and model selection close at hand.'
      },
      {
        role: 'assistant',
        text: [
          'Start with a clear content hierarchy:',
          '',
          '- **Session navigation**: group conversations by project with concise titles.',
          '- **Conversation area**: leave reading room so messages can breathe.',
          '- **Composer and tools**: keep the common actions within reach and the input light.',
          '',
          '```ts',
          'const workspace = {',
          '  project: "Aurora Studio",',
          '  pages: ["overview", "workspace"],',
          '  status: "draft"',
          '}',
          '```',
          '',
          'Next, confirm the layout, then refine each page one by one.'
        ].join('\n')
      }
    ])
    await use(agentDir)
  }
})

async function activateSkin(page: Page, style: CaptureSkin, skinId?: string) {
  const destination = page.url().includes('#/workspace')
    ? 'workspace'
    : page.url().includes('#/git')
      ? 'git'
      : page.url().includes('#/models')
        ? 'models'
        : 'settings'

  await page.locator('a[href="#/settings"]').click()
  await page.getByTestId('settings-section-mascot').click()
  const option = page.locator(`[data-mascot-option="${style}"]`)
  await expect(option).toBeVisible()
  await option.click()
  await expect
    .poll(() => page.evaluate(() => window.piSwitch.settings.get().then((s) => s.mascotStyle)))
    .toBe(style)
  if (style === 'none') {
    await expect(page.locator('html')).not.toHaveAttribute('data-visual-skin')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'soft-light')
  } else {
    await expect(page.locator('html')).toHaveAttribute('data-visual-skin', skinId!)
  }

  if (destination === 'workspace') {
    await openSession(page, {
      cwd: AURORA,
      sessionId,
      title: 'Designing a calm desktop workspace'
    })
    await expect(page.getByTestId('chat-composer')).toBeVisible()
    await expect(page.locator('.assistant-message-body pre code')).toContainText('Aurora Studio')
  } else if (destination === 'git') {
    await openOverflowPage(page, 'git')
  } else if (destination === 'models') {
    await page.locator('a[href="#/models"]').click()
  }

  if (style === 'none') return
  if (style === 'starshipCockpit') {
    const backdrop = page.getByTestId('starship-cockpit-backdrop')
    const interior = page.getByTestId('starship-cockpit-interior')
    await expect(backdrop).toBeVisible()
    await expect(interior).toBeVisible()
    await backdrop.locator('img').evaluateAll(async (images) => {
      await Promise.all(images.map((image) => (image as HTMLImageElement).decode()))
    })
    await interior.locator('img').evaluate(async (image) => (image as HTMLImageElement).decode())
  } else {
    await expect(page.getByTestId('ming-shell-frame')).toBeVisible()
    const scene =
      style === 'mingSnow' ? 'snow-palace' : style === 'mingMoon' ? 'moon-city' : 'snow-red-palace'
    await expect(page.getByTestId('app-shell')).toHaveCSS('background-image', new RegExp(scene))
    await page.getByTestId('app-shell').evaluate(async (element) => {
      const source = getComputedStyle(element).backgroundImage.match(/url\("?([^")]+)"?\)/)?.[1]
      if (!source) throw new Error('Ming scene background is missing')
      const image = new Image()
      image.src = source
      await image.decode()
    })
    if (destination === 'workspace') {
      const portrait = page.getByTestId('portrait-skin-image')
      await expect(portrait).toBeVisible()
      await portrait.evaluate(async (image) => (image as HTMLImageElement).decode())
      await expect(page.getByTestId('ming-workspace-ornaments')).toBeVisible()
    }
  }
  await page.evaluate(() => document.fonts.ready)
}

async function openDemoSession(page: Page) {
  await page.setViewportSize(VIEWPORT)
  await openSession(page, { cwd: AURORA, sessionId, title: 'Designing a calm desktop workspace' })
  await expect(page.getByTestId('chat-composer')).toBeVisible()
  await expect(page.locator('.assistant-message-body')).toBeVisible()
  await expect(page.locator('.assistant-message-body pre code')).toContainText('Aurora Studio')
  await expect(page.locator('[data-sonner-toast]:visible')).toHaveCount(0)
}

/** BrowserWindow.capturePage includes the native architecture WebContentsView. */
async function nativeShot(
  page: Page,
  electronApp: ElectronApplication,
  docsRelativePath: string
) {
  const target = await shot(page, docsRelativePath)
  const nativeWindow = await electronApp.browserWindow(page)
  await nativeWindow.evaluate(
    (window, size) => window.setContentSize(size.width, size.height),
    VIEWPORT
  )
  await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([
    VIEWPORT.width,
    VIEWPORT.height
  ])
  const png = await nativeWindow.evaluate(
    async (window) => (await window.capturePage()).toPNG().toString('base64')
  )
  fs.writeFileSync(target, Buffer.from(png, 'base64'))
}

test('capture Ming and Starship workspaces', async ({ page }) => {
  await openDemoSession(page)
  for (const capture of [
    {
      style: 'zhangJuzhengSnow',
      skin: 'zhang-juzheng-snow',
      output: '主题展示/大明/雪境朝臣.png'
    },
    { style: 'mingSnow', skin: 'ming-snow', output: '主题展示/大明/雪夜笛姬.png' },
    { style: 'mingMoon', skin: 'ming-moon', output: '主题展示/大明/月城书姬.png' },
    {
      style: 'starshipCockpit',
      skin: 'starship-cockpit',
      output: '主题展示/星舰/霜星领航.png'
    }
  ] as const) {
    await activateSkin(page, capture.style, capture.skin)
    await expect(page.locator('[data-sonner-toast]:visible')).toHaveCount(0)
    await shot(page, capture.output)
  }
})

test('capture Ming functional pages', async ({ page, electronApp }) => {
  await openDemoSession(page)

  await activateSkin(page, 'zhangJuzhengSnow', 'zhang-juzheng-snow')
  await openOverflowPage(page, 'git')
  await expect(page.getByTestId('git-view')).toBeVisible()
  await expect(page.getByTestId('git-history-graph').locator(':scope > div')).toHaveCount(3)
  await expect(
    page.getByTestId('git-history-graph').getByText('Refine theme tokens', { exact: true })
  ).toBeVisible()
  await expect(
    page.getByTestId('git-repository-sidebar').locator('[data-git-branch="main"]')
  ).toBeVisible()
  await expect(page.getByTestId('git-commit-panel')).toBeVisible()
  await shot(page, '功能界面/大明/Git.png')

  await activateSkin(page, 'mingMoon', 'ming-moon')
  await page.locator('a[href="#/models"]').click()
  await page.getByTestId('model-management-tab-providers').click()
  await expect(page.getByTestId('provider-row')).toHaveCount(2)
  await expect(page.getByTestId('providers-table-scroll')).toBeVisible()
  await shot(page, '功能界面/大明/Provider与模型.png')

  await electronApp.evaluate(({ ipcMain }, channel) => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, () => ({
      ok: true,
      data: { items: [], total: 0, page: 1, pageSize: 50, totalPages: 0, fetchedAt: Date.now() }
    }))
  }, IPC_INVOKE.packagesRegistrySearch)
  await openOverflowPage(page, 'skills')
  await page.getByRole('tab', { name: 'Skills', exact: true }).click()
  const cards = page.locator('[data-testid^="featured-capability-"]')
  await expect(cards).toHaveCount(3)
  await cards.first().click()
  await expect(cards.first()).toContainText('Native Pi')
  await expect(page.getByTestId('featured-capability-install')).toHaveCount(0)
  await shot(page, '功能界面/大明/能力中心.png')

  await page.locator('a[href="#/settings"]').click()
  await expect(page.locator('h1').filter({ hasText: 'General' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Theme', exact: true })).toBeVisible()
  await shot(page, '功能界面/大明/通用设置.png')
})

test('capture Ming project architecture', async ({ page, electronApp }) => {
  await openDemoSession(page)
  await activateSkin(page, 'mingMoon', 'ming-moon')
  await page.getByTestId('workspace-architecture').click()
  await page.getByTestId('analyze-project').click()
  await expect(page.getByTestId('architecture-status')).toContainText('Analysis complete', {
    timeout: 45_000
  })
  await expect(page.getByTestId('architecture-viewer')).toBeVisible()
  await expect
    .poll(() =>
      electronApp.evaluate(async ({ webContents }) => {
        const view = webContents
          .getAllWebContents()
          .find((candidate) => candidate.getURL().startsWith('pi-architecture:'))
        if (!view) return 0
        return view.executeJavaScript(`(() =>
          [...document.querySelectorAll('[data-node-id]')].filter((node) => {
            const box = node.getBoundingClientRect()
            const style = getComputedStyle(node)
            const animations = node.getAnimations({ subtree: true })
            return box.width > 0 && box.height > 0 &&
              box.right > 0 && box.bottom > 0 &&
              box.left < innerWidth && box.top < innerHeight &&
              style.visibility !== 'hidden' && Number(style.opacity) > 0.9 &&
              animations.every((animation) => animation.playState === 'finished')
          }).length
        )()`)
      })
    )
    .toBe(4)
  await electronApp.evaluate(async ({ webContents }) => {
    const view = webContents
      .getAllWebContents()
      .find((candidate) => candidate.getURL().startsWith('pi-architecture:'))!
    await view.executeJavaScript(
      'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
    )
  })
  await expect(page.getByTestId('architecture-module').filter({ hasText: 'main.ts' })).toBeVisible()
  await nativeShot(page, electronApp, '功能界面/大明/项目架构.png')
})

test('capture Ming and classic theme galleries', async ({ page }) => {
  await page.setViewportSize(VIEWPORT)
  await page.locator('a[href="#/settings"]').click()
  await page.getByTestId('settings-section-mascot').click()
  await expect(page.locator('h1').filter({ hasText: 'Theme' })).toBeVisible()
  const grid = page.getByTestId('mascot-options-grid')
  const options = grid.locator('[data-mascot-option]')
  await expect(options).toHaveCount(9)

  await grid.locator('[data-mascot-option="mingMoon"]').click()
  await expect
    .poll(() => page.evaluate(() => window.piSwitch.settings.get().then((s) => s.mascotStyle)))
    .toBe('mingMoon')
  await expect(page.locator('html')).toHaveAttribute('data-visual-skin', 'ming-moon')

  for (let index = 0; index < 9; index += 1) {
    const option = options.nth(index)
    await option.scrollIntoViewIfNeeded()
    const image = option.locator('img')
    if (await image.count()) {
      await image.evaluate(async (element) => (element as HTMLImageElement).decode())
    }
  }
  await options.first().scrollIntoViewIfNeeded()
  await expect(options.first()).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await expect(page.locator('[data-sonner-toast]:visible')).toHaveCount(0)
  await shot(page, '功能界面/大明/主题皮肤库.png')

  await grid.locator('[data-mascot-option="none"]').click()
  await expect
    .poll(() => page.evaluate(() => window.piSwitch.settings.get().then((s) => s.mascotStyle)))
    .toBe('none')
  await expect(page.locator('html')).not.toHaveAttribute('data-visual-skin')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'soft-light')
  await options.first().scrollIntoViewIfNeeded()
  await shot(page, '功能界面/经典主题/主题皮肤库.png')
})

import fs from 'node:fs'
import path from 'node:path'
import { test as base, expect, startFixtureSession } from '../fixtures'
import type { ElectronApplication, Page } from '@playwright/test'
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

const sessionId = 'docs-workspace-demo'

const conversations = [
  {
    id: sessionId,
    prompt: 'Design a clean, comfortable desktop workspace',
    response: [
      'Start with a clear content hierarchy:',
      '',
      '- **Session navigation**: group conversations by project with concise titles.',
      '- **Conversation area**: leave reading room so messages can breathe.',
      '- **Composer and tools**: keep common actions within reach and the input light.',
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
  },
  {
    id: 'docs-navigation-review',
    prompt: 'Review the workspace navigation',
    response: 'The project navigation is clear. Keep the active conversation visible and group secondary destinations under More.'
  },
  {
    id: 'docs-color-tokens',
    prompt: 'Refine the color tokens',
    response: 'Use a warm neutral canvas, restrained borders, and one accent color for selected states and primary actions.'
  },
  {
    id: 'docs-keyboard-shortcuts',
    prompt: 'Add keyboard shortcuts',
    response: 'Document the existing navigation, search, save, and composer shortcuts in one consistent reference.'
  },
  {
    id: 'docs-release-notes',
    prompt: 'Prepare release notes',
    response: 'Summarize the visible improvements in concise Added and Fixed sections, without internal implementation details.'
  },
  {
    id: 'docs-session-storage',
    prompt: 'Audit session storage',
    response: 'Verify that session history remains compatible with Pi JSONL and that cleanup only affects the selected scope.'
  }
] as const

const test = base.extend({
  piAgentDir: async ({ testUserData }, use) => {
    const agentDir = path.join(testUserData, 'mock-pi')
    fs.cpSync(path.resolve('fixtures/mock-pi'), agentDir, { recursive: true })
    writeProfileSettings(testUserData)
    ensureAuroraWorkspace()
    for (const conversation of conversations) {
      seedConversation(agentDir, AURORA, conversation.id, [
        { role: 'user', text: conversation.prompt },
        { role: 'assistant', text: conversation.response }
      ])
    }
    await use(agentDir)
  }
})

async function openDemo(page: Parameters<typeof openSession>[0]) {
  await page.setViewportSize(VIEWPORT)
  await openSession(page, {
    cwd: AURORA,
    sessionId,
    title: 'Designing a calm desktop workspace'
  })
  await expect(page.getByTestId('chat-composer')).toBeVisible()
  await expect(page.locator('.assistant-message-body')).toBeVisible()
}

/** BrowserWindow.capturePage includes the native architecture WebContentsView. */
async function nativeShot(
  page: Page,
  electronApp: ElectronApplication,
  docsRelativePath: string
) {
  const target = await shot(page, docsRelativePath)
  const nativeWindow = await electronApp.browserWindow(page)
  await nativeWindow.evaluate((window) => window.setContentSize(VIEWPORT.width, VIEWPORT.height))
  await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([
    VIEWPORT.width,
    VIEWPORT.height
  ])
  const png = await nativeWindow.evaluate(
    async (window) => (await window.capturePage()).toPNG().toString('base64')
  )
  fs.writeFileSync(target, Buffer.from(png, 'base64'))
}

test('capture workspace and code editor', async ({ page }) => {
  await openDemo(page)
  await shot(page, '功能界面/经典主题/工作区.png')

  await page.getByTestId('workspace-toggle-files').click()
  await expect(page.getByTestId('workspace-files-panel')).toBeVisible()
  await page.getByRole('button', { name: 'src', exact: true }).click()
  await page.getByRole('button', { name: 'theme', exact: true }).click()
  await page.getByRole('button', { name: 'tokens.css', exact: true }).click()
  const editor = page.getByTestId('file-code-view').locator('.cm-content')
  await expect(editor).toBeVisible()
  await expect(editor).toContainText('--accent: #7a5bd3')
  await shot(page, '功能界面/经典主题/代码编辑.png')
})

test('capture conversation history cleanup and Git', async ({ page }) => {
  await openDemo(page)

  await openOverflowPage(page, 'ai-sessions')
  await expect(page.getByTestId('universal-sessions')).toBeVisible()
  const historySession = page.getByRole('button', {
    name: /View: Design a clean, comfortable desktop workspace/
  })
  await expect(historySession).toBeVisible({ timeout: 30_000 })
  await historySession.click()
  await expect(page.getByTestId('history-messages')).toContainText('Start with a clear content hierarchy')
  await expect(page.getByTestId('history-session-list')).not.toContainText('Loading')
  await shot(page, '功能界面/经典主题/会话历史.png')

  await page.locator('a[href="#/settings"]').click()
  await page.getByTestId('settings-section-session-cleanup').click()
  const scope = page.getByRole('button', { name: /Cleanup scope/ })
  await scope.click()
  await page.getByRole('option', { name: /All historical sessions/ }).click()
  await page.getByTestId('session-cleanup-scan').click()
  await expect(page.getByTestId('session-cleanup-preview')).toContainText('6')
  await shot(page, '功能界面/经典主题/会话清理.png')

  await page.locator('a[href="#/workspace"]').click()
  await openOverflowPage(page, 'git')
  await expect(page.getByTestId('git-view')).toBeVisible()
  const graph = page.getByTestId('git-history-graph')
  await expect(graph.locator(':scope > div')).toHaveCount(3)
  await expect(graph).toContainText('Refine theme tokens')
  await expect(page.getByTestId('git-commit-panel')).toBeVisible()
  await shot(page, '功能界面/经典主题/Git.png')
})

test.use({ fakeAudio: true })
test('capture workspace voice preparation', async ({ page }) => {
  await page.setViewportSize(VIEWPORT)
  await page.evaluate(async () => {
    const voice = await window.piSwitch.agentSettings.voice.get()
    await window.piSwitch.agentSettings.voice.save({
      enabled: true,
      providerKey: 'openai-compatible',
      endpoint: voice.endpoint,
      model: voice.model,
      voice: voice.voice,
      profile: voice.profile
    })
  })
  await openDemo(page)
  await page.getByTestId('workspace-voice-trigger').click()
  const preparation = page.getByRole('dialog').filter({ hasText: 'Prepare voice' })
  await expect(preparation).toBeVisible()
  await preparation.getByRole('checkbox').check()
  await expect(preparation).toContainText('Only the last 6 plain-text messages are shared')
  await shot(page, '功能界面/经典主题/工作区语音.png')
})

test('capture Harness and multi-agent orchestration', async ({ page }) => {
  await openDemo(page)
  await startFixtureSession(page, {
    sessionId,
    cwd: AURORA,
    provider: 'openai-compatible',
    modelId: 'gpt-4o'
  })
  await page.evaluate(
    (id) => window.piSwitch.harness.setModel(id, 'openai-compatible', 'gpt-4o'),
    sessionId
  )
  await page.getByTestId('workspace-section-tools').click()
  const consolePanel = page.getByTestId('harness-console')
  await expect(consolePanel).toBeVisible()
  await expect(consolePanel).toContainText(sessionId)
  await expect(consolePanel).toContainText('openai-compatible / gpt-4o')
  await expect(consolePanel).toContainText('idle')
  await shot(page, '功能界面/经典主题/工具Harness-1.png')

  const steering = page.getByPlaceholder('Steer the current run…')
  const followUp = page.getByPlaceholder('Queue work after the current run…')
  if (await steering.isEnabled()) {
    await steering.fill('Keep the current workspace context while checking the layout.')
    await page.getByRole('button', { name: /Queue steering/ }).click()
  }
  if (await followUp.isEnabled()) {
    await followUp.fill('Summarize the final navigation recommendations.')
    await page.getByRole('button', { name: /Queue follow-up/ }).click()
  }
  await consolePanel.getByRole('button', { name: 'Session', exact: true }).click()
  await expect(consolePanel).toContainText(sessionId)
  await expect(consolePanel.getByText('assistant', { exact: true })).toBeVisible()
  await shot(page, '功能界面/经典主题/工具Harness-2.png')

  const orchestrationId = await page.evaluate(async (cwd) => {
    const run = await window.piSwitch.orchestration.create({
      name: 'Aurora workspace refresh',
      cwd,
      strategy: 'dependency',
      maxConcurrentAgents: 3,
      maxConcurrentRuns: 3
    })
    const common = {
      orchestrationId: run.id,
      provider: 'openai-compatible',
      modelId: 'gpt-4o',
      workspaceMode: 'shared' as const
    }
    const reviewer = await window.piSwitch.orchestration.addAgent({
      ...common,
      name: 'Reviewer',
      role: 'reviewer',
      description: 'Checks usability, consistency, and release readiness.',
      isReviewer: true
    })
    const builder = await window.piSwitch.orchestration.addAgent({
      ...common,
      name: 'Builder',
      role: 'builder',
      description: 'Implements the approved workspace layout.'
    })
    const planner = await window.piSwitch.orchestration.addAgent({
      ...common,
      name: 'Planner',
      role: 'planner',
      description: 'Defines the information architecture and delivery plan.'
    })
    const design = await window.piSwitch.orchestration.createTask({
      orchestrationId: run.id,
      title: 'Design the workspace',
      description: 'Define the navigation, content hierarchy, and visual direction.',
      assignedAgentId: planner.id,
      priority: 'high'
    })
    const implementation = await window.piSwitch.orchestration.createTask({
      orchestrationId: run.id,
      title: 'Implement the layout',
      description: 'Build the approved layout and connect the existing workspace state.',
      assignedAgentId: builder.id,
      dependencies: [design.id],
      priority: 'high'
    })
    await window.piSwitch.orchestration.createTask({
      orchestrationId: run.id,
      title: 'Review the change',
      description: 'Verify the result against the design and request a final review.',
      assignedAgentId: reviewer.id,
      dependencies: [implementation.id],
      reviewRequired: true
    })
    return run.id
  }, AURORA)
  expect(orchestrationId).toBeTruthy()
  await page.locator('#workspace-tool-tab-orchestration').click()
  const orchestration = page.getByTestId('orchestration-console')
  await expect(orchestration).toBeVisible()
  await orchestration.getByRole('button', { name: 'Agents', exact: true }).click()
  await expect(orchestration.getByTestId('orchestration-agent-card')).toHaveCount(3)
  await expect(orchestration.getByTestId('orchestration-agents-panel')).toContainText('Reviewer')
  await expect(orchestration.getByTestId('orchestration-agents-panel')).toContainText('Builder')
  await expect(orchestration.getByTestId('orchestration-agents-panel')).toContainText('Planner')
  await shot(page, '功能界面/经典主题/多智能体-团队.png')

  await orchestration.getByRole('button', { name: 'Tasks', exact: true }).click()
  const tasks = orchestration.getByTestId('orchestration-tasks-panel')
  await expect(tasks.getByTestId('orchestration-task-card')).toHaveCount(3)
  await expect(tasks).toContainText('Depends on')
  await expect(tasks).toContainText('review')
  await shot(page, '功能界面/经典主题/多智能体-任务依赖.png')
})

test('capture project architecture views', async ({ page, electronApp }) => {
  await openDemo(page)
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
          .find((item) => item.getURL().startsWith('pi-architecture:'))
        if (!view) return 0
        return view.executeJavaScript('document.querySelectorAll("[data-node-id]").length')
      })
    )
    .toBeGreaterThan(0)
  await nativeShot(page, electronApp, '功能界面/经典主题/项目架构-1.png')

  const modules = page.getByTestId('architecture-module-browser')
  const appModule = modules.getByTestId('architecture-module').filter({ hasText: 'src/app.ts' })
  await appModule.click()
  const details = page.getByTestId('architecture-module-details')
  await expect(details).toBeVisible()
  await expect(details).toContainText('app.ts')
  await nativeShot(page, electronApp, '功能界面/经典主题/项目架构-2.png')

  await page.getByTestId('architecture-source').click()
  await expect(page.getByTestId('architecture-code')).toBeVisible()
  await expect(page.getByRole('dialog')).toContainText('Aurora Studio/src/app.ts')
  await nativeShot(page, electronApp, '功能界面/经典主题/项目架构-3.png')
})

test('capture desktop pet settings menu and actions', async ({ page, electronApp, testUserData }) => {
  fs.cpSync(
    '/Users/tree/codes/my-codes/pi-Harness-packages/pet-bigfish',
    path.join(testUserData, 'petpacks', 'bigfish'),
    { recursive: true }
  )
  await page.setViewportSize(VIEWPORT)
  const settings = await page.evaluate(() => window.piSwitch.settings.get())
  await page.evaluate(
    (desktopPet) => window.piSwitch.settings.set({ language: 'en-US', desktopPet }),
    {
      ...settings.desktopPet,
      enabled: true,
      size: 160,
      idleVariants: false,
      bubbleTimeoutSeconds: 0
    }
  )
  await page.locator('a[href="#/settings"]').click()
  await page.getByTestId('settings-section-desktop-pet').click()
  await expect(page.getByTestId('desktop-pet-section')).toBeVisible()
  await expect(page.getByTestId('desktop-pet-section').getByRole('slider')).toHaveCount(4)
  await shot(page, '功能界面/经典主题/桌宠设置.png')

  await expect
    .poll(() => electronApp.windows().some((win) => win.url().includes('/pet.html')))
    .toBe(true)
  const pet = electronApp.windows().find((win) => win.url().includes('/pet.html'))!
  await pet.setViewportSize(VIEWPORT)
  const image = pet.locator('#app img')
  await expect(image).toBeVisible()
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
  await pet.evaluate(() => window.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
  const menu = pet.getByRole('menu')
  await expect(menu.getByRole('menuitem', { name: 'Open Pi-Harness', exact: true })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: /Play action \(193\)/ })).toBeVisible()
  await shot(pet, '功能界面/经典主题/桌宠菜单.png')

  await menu.getByRole('menuitem', { name: /Play action \(193\)/ }).click()
  await expect(pet.getByRole('searchbox')).toBeVisible()
  await expect(pet.locator('[data-clip]')).toHaveCount(193)
  await shot(pet, '功能界面/经典主题/桌宠动作.png')
})

import fs from 'node:fs'
import path from 'node:path'
import { test as base, expect } from '../fixtures'
import { APP_THEMES, type AppTheme } from '../../src/shared/constants/theme'
import {
  AURORA,
  ensureAuroraWorkspace,
  openSession,
  seedConversation,
  shot,
  writeProfileSettings
} from './helpers'

const sessionId = 'docs-demo-workspace'

const test = base.extend<{ galleryTheme: AppTheme }>({
  galleryTheme: ['soft-light', { option: true }],
  piAgentDir: async ({ testUserData, galleryTheme }, use) => {
    const agentDir = path.join(testUserData, 'mock-pi')
    fs.cpSync(path.resolve('fixtures/mock-pi'), agentDir, { recursive: true })
    writeProfileSettings(testUserData, { theme: galleryTheme })
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

for (const theme of APP_THEMES) {
  test.describe(theme, () => {
    test.use({ galleryTheme: theme })

    test(`capture ${theme} workspace`, async ({ page }) => {
      await page.setViewportSize({ width: 1600, height: 1000 })
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await openSession(page, { cwd: AURORA, sessionId, title: 'Designing a calm desktop workspace' })
      await expect(page.getByTestId('chat-composer')).toBeVisible()
      await expect(page.locator('.assistant-message-body')).toBeVisible()
      await expect(page.locator('.assistant-message-body pre code')).toContainText('Aurora Studio')
      await page.evaluate(() => document.fonts.ready)

      if (theme === 'macos27' || theme === 'macos27-light') {
        const backdrop = page.getByTestId('macos27-optics-backdrop')
        await expect(backdrop).toHaveAttribute('data-renderer', /full|reduced/)
        await expect(backdrop.locator('canvas')).toBeVisible()
        await page.evaluate(
          () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
        )
      }

      await shot(page, `主题展示/经典主题/${theme}.png`)
    })
  })
}

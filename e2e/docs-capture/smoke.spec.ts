import fs from 'node:fs'
import path from 'node:path'
import { test as base, expect } from '../fixtures'
import {
  AURORA,
  ensureAuroraWorkspace,
  openSession,
  seedConversation,
  shot,
  writeProfileSettings
} from './helpers'

const sessionId = 'docs-demo-workspace'

const test = base.extend({
  piAgentDir: async ({ testUserData }, use) => {
    const agentDir = path.join(testUserData, 'mock-pi')
    fs.cpSync(path.resolve('fixtures/mock-pi'), agentDir, { recursive: true })
    writeProfileSettings(testUserData)
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

test('capture workspace and general settings', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await openSession(page, { cwd: AURORA, sessionId, title: 'Designing a calm desktop workspace' })
  const composer = page.getByTestId('chat-composer')
  await expect(composer).toBeVisible()
  await expect(page.locator('.assistant-message-body')).toBeVisible()
  await shot(page, '功能界面/经典主题/工作区.png')

  await page.locator('a[href="#/settings"]').click()
  await expect(page.getByRole('button', { name: /Theme/, exact: true })).toBeVisible()
  await shot(page, '功能界面/经典主题/通用设置.png')
})

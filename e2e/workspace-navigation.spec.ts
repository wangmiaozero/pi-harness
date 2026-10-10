import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { test, expect } from './fixtures'
import { projectIdentityKey } from '../src/shared/workspace/project-identity'

test('combines standalone chats and projects in one workspace section', async ({
  page,
  piAgentDir
}) => {
  const visualQa = Boolean(process.env.PI_HARNESS_DESIGN_QA_DIR)
  await page.setViewportSize(
    visualQa ? { width: 2048, height: 1324 } : { width: 2400, height: 1560 }
  )
  await expect(page.getByText('Pi-Harness').first()).toBeVisible({ timeout: 30_000 })
  if (visualQa) {
    await page.evaluate(async () => {
      await window.piSwitch.settings.unlockMascot('1024')
      await window.piSwitch.settings.set({ theme: 'dark', mascotStyle: 'mingMoon' })
    })
  } else {
    await page.evaluate(() => window.piSwitch.settings.set({ theme: 'light' }))
  }
  await page.locator('a[href="#/workspace"]').click()
  if (!visualQa) {
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'light'
    })
  }

  const workspaceSection = page.getByTestId('workspace-section-workspace')
  const commandActions = page.getByTestId('workspace-command-actions')
  expect((await commandActions.boundingBox())!.width).toBeLessThanOrEqual(124)
  await expect(workspaceSection).toHaveAttribute('aria-pressed', 'true')
  await expect(workspaceSection).toHaveText(/工作区|Workspace/)
  await expect(page.getByTestId('workspace-section-projects')).toHaveCount(0)
  await expect(page.getByTestId('workspace-section-sessions')).toHaveCount(0)

  const tree = page.getByTestId('workspace-session-tree')
  await expect(tree.getByTestId('workspace-chat-list')).toBeVisible()
  await expect(tree.getByTestId('workspace-sessions-heading')).toHaveText(/会话|Sessions/)
  await expect(tree.getByTestId('workspace-projects-heading')).toHaveText(/项目|Projects/)
  await expect(tree.getByTestId('workspace-draft-session')).toBeVisible()

  const defaultRoot = await page.evaluate(() => window.piSwitch.workspace.getDefaultRoot())
  expect(defaultRoot).not.toBeNull()
  const sessionId = '01a026a4-0796-73ff-990a-a2be2198354e'
  seedSession(piAgentDir, defaultRoot!, sessionId, 'Standalone chat')
  const projectKey = projectIdentityKey(defaultRoot!)
  await page.evaluate(
    ({ id, root, key }) =>
      window.piSwitch.workspace.bindSession(
        id,
        `session:${id}`,
        [{ id: key, path: root, role: 'main' }],
        key
      ),
    { id: sessionId, root: defaultRoot!, key: projectKey }
  )

  await page.reload()
  await page.getByTestId('workspace-refresh').click()
  await expect(tree.getByText('Standalone chat', { exact: true })).toBeVisible()
  await expect(tree.locator('[data-testid^="workspace-project-group-"]')).toHaveCount(0)
  await expect(tree.getByText(/默认工作区|Default workspace/, { exact: true })).toHaveCount(0)
  await tree.getByText('Standalone chat', { exact: true }).click()
  await expect(page.getByTestId(`session-row-${sessionId}`)).toHaveClass(/bg-/)

  if (process.env.PI_HARNESS_DESIGN_QA_DIR) {
    await page.screenshot({
      path: path.join(process.env.PI_HARNESS_DESIGN_QA_DIR, 'workspace-unified-navigation.png')
    })
  }
})

const profileTest = test.extend({
  testUserData: async ({}, use) => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-harness-profile-e2e-'))
    const userData = path.join(parent, 'Pi-Harness-dev')
    fs.mkdirSync(userData)
    try {
      await use(userData)
    } finally {
      fs.rmSync(parent, { recursive: true, force: true })
    }
  }
})

profileTest(
  'groups current and older app-profile chats under Sessions while keeping real default projects',
  async ({ page, testUserData, piAgentDir, workspaceRoot }, testInfo) => {
    const current = await page.evaluate(() => window.piSwitch.workspace.getDefaultRoot())
    const legacy = path.join(
      path.dirname(fs.realpathSync(testUserData)),
      'Pi-Harness',
      'workspaces',
      'default'
    )
    const ordinary = path.join(fs.realpathSync(workspaceRoot), 'default')
    fs.mkdirSync(legacy, { recursive: true })
    fs.mkdirSync(ordinary)
    const chats = [
      { root: legacy, id: '01a126a4-0796-73ff-990a-a2be2198354e', title: 'Older standalone chat' },
      {
        root: current!,
        id: '01a226a4-0796-73ff-990a-a2be2198354e',
        title: 'Current standalone chat'
      },
      {
        root: ordinary,
        id: '01a326a4-0796-73ff-990a-a2be2198354e',
        title: 'Real default project chat'
      }
    ]
    for (const chat of chats) seedSession(piAgentDir, chat.root, chat.id, chat.title)
    const grants = () => fs.readFileSync(path.join(testUserData, 'authorized-roots.json'), 'utf8')
    const before = grants()
    const identities = await page.evaluate(() => window.piSwitch.workspace.getDefaultRoots())
    expect(identities).toContain(legacy)
    expect(grants()).toBe(before)
    await page.reload()
    await page.locator('a[href="#/workspace"]').click()
    await page.getByTestId('workspace-refresh').click()
    const tree = page.getByTestId('workspace-session-tree')
    const standalone = tree.getByTestId('workspace-chat-list')
    await expect(standalone.getByText('Older standalone chat', { exact: true })).toBeVisible()
    await expect(standalone.getByText('Current standalone chat', { exact: true })).toBeVisible()
    await expect(standalone.getByText('Real default project chat', { exact: true })).toHaveCount(0)
    const projects = tree.locator('[data-testid^="workspace-project-group-"]')
    await expect(projects).toHaveCount(1)
    await expect(projects.getByText('default', { exact: true })).toBeVisible()
    await expect(projects.getByText('Real default project chat', { exact: true })).toBeVisible()
    await expect(projects.getByText('Older standalone chat', { exact: true })).toHaveCount(0)
    await expect(projects.getByText('Current standalone chat', { exact: true })).toHaveCount(0)
    await page.screenshot({ path: path.join(testInfo.outputDir, 'profile-chats-grouped.png') })
  }
)

function seedSession(agentDir: string, cwd: string, sessionId: string, label: string) {
  const safePath = `--${path
    .resolve(cwd)
    .replace(/^[/\\]/, '')
    .replace(/[/\\:]/g, '-')}--`
  const sessionDir = path.join(agentDir, 'sessions', safePath)
  const timestamp = '2026-09-30T05:00:00.000Z'
  fs.mkdirSync(sessionDir, { recursive: true })
  fs.writeFileSync(
    path.join(sessionDir, `2026-09-30T05-00-00-000Z_${sessionId}.jsonl`),
    [
      JSON.stringify({ type: 'session', version: 3, id: sessionId, timestamp, cwd }),
      JSON.stringify({
        type: 'message',
        id: 'standalone-user',
        parentId: null,
        timestamp,
        message: { role: 'user', content: label, timestamp: Date.parse(timestamp) }
      }),
      JSON.stringify({
        type: 'message',
        id: 'standalone-assistant',
        parentId: 'standalone-user',
        timestamp,
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'This chat is not attached to a project folder.' }],
          timestamp: Date.parse(timestamp)
        }
      })
    ].join('\n') + '\n'
  )
}

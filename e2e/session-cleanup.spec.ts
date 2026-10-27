import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, type Page } from '@playwright/test'
import { test } from './fixtures'

const require = createRequire(import.meta.url)
const electronBinary = require('electron') as string
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const mainJs = path.join(root, 'out/main/index.js')

interface SeedOptions {
  id: string
  cwd: string
  ageDays: number
  parentPath?: string
}

/** Write a real Pi JSONL session fixture under the isolated agent dir. */
function seedSession(piAgentDir: string, options: SeedOptions): string {
  const directory = path.join(piAgentDir, 'sessions', `fixture-${options.id}`)
  fs.mkdirSync(directory, { recursive: true })
  const file = path.join(directory, `${options.id}.jsonl`)
  const timestamp = new Date(Date.now() - options.ageDays * 24 * 60 * 60_000).toISOString()
  const header: Record<string, unknown> = {
    type: 'session',
    version: 3,
    id: options.id,
    timestamp,
    cwd: options.cwd
  }
  if (options.parentPath) header.parentSession = options.parentPath
  const message = {
    type: 'message',
    id: `${options.id}-entry`,
    parentId: null,
    timestamp,
    message: {
      role: 'user',
      content: [{ type: 'text', text: `Fixture session ${options.id}` }],
      timestamp: Date.parse(timestamp)
    }
  }
  fs.writeFileSync(file, [JSON.stringify(header), JSON.stringify(message)].join('\n') + '\n')
  fs.utimesSync(file, new Date(Date.parse(timestamp)), new Date(Date.parse(timestamp)))
  return file
}

async function openSettingsWorkspace(page: Page): Promise<void> {
  await page.locator('a[href="#/settings"]').click()
  await page.getByTestId('settings-section-session-cleanup').click()
  await expect(page.getByTestId('session-cleanup-scan')).toBeVisible()
}

async function chooseScope(page: Page, label: RegExp): Promise<void> {
  await page.getByRole('button', { name: /清理范围|Cleanup scope/ }).click()
  await page.getByRole('option', { name: label }).click()
}

test('permanently deletes historical sessions after two confirmations and updates the sidebar immediately', async ({
  page,
  electronApp,
  piAgentDir,
  workspaceRoot
}) => {
  const projectA = path.join(workspaceRoot, 'project-a')
  const projectB = path.join(workspaceRoot, 'project-b')
  fs.mkdirSync(projectA, { recursive: true })
  fs.mkdirSync(projectB, { recursive: true })
  const oldA = seedSession(piAgentDir, { id: 'old-a', cwd: projectA, ageDays: 120 })
  const oldB = seedSession(piAgentDir, { id: 'old-b', cwd: projectB, ageDays: 120 })
  const recentA = seedSession(piAgentDir, { id: 'recent-a', cwd: projectA, ageDays: 1 })

  await openSettingsWorkspace(page)

  // --- First confirmation is cancellable at both steps ---------------------
  await chooseScope(page, /全部历史会话|All historical sessions/)
  await page.getByTestId('session-cleanup-scan').click()
  const preview = page.getByTestId('session-cleanup-preview')
  await expect(preview).toContainText(/3/)
  await page.getByTestId('session-cleanup-execute').click()
  const firstDialog = page.getByRole('dialog')
  await expect(firstDialog).toContainText(/永久删除历史会话|Delete historical sessions permanently/)
  await expect(firstDialog).toContainText(/3/)
  await firstDialog.getByRole('button', { name: /取消|Cancel/, exact: true }).click()
  await expect(firstDialog).toHaveCount(0)
  expect(fs.existsSync(oldA)).toBe(true)
  expect(fs.existsSync(oldB)).toBe(true)
  expect(fs.existsSync(recentA)).toBe(true)

  await page.getByTestId('session-cleanup-execute').click()
  const firstAgain = page.getByRole('dialog')
  await expect(firstAgain).toBeVisible()
  await firstAgain.getByRole('button', { name: /继续|Continue/ }).click()
  const secondDialog = page.getByRole('dialog')
  await expect(secondDialog).toContainText(/请再次确认|confirm again/)
  await secondDialog.getByRole('button', { name: /取消|Cancel/, exact: true }).click()
  await expect(secondDialog).toHaveCount(0)
  expect(fs.existsSync(oldA)).toBe(true)
  expect(fs.existsSync(oldB)).toBe(true)
  expect(fs.existsSync(recentA)).toBe(true)

  // --- Escape on the second dialog also aborts ------------------------------
  await page.getByTestId('session-cleanup-execute').click()
  const firstThird = page.getByRole('dialog')
  await expect(firstThird).toBeVisible()
  await firstThird.getByRole('button', { name: /继续|Continue/ }).click()
  const secondThird = page.getByRole('dialog')
  await expect(secondThird).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(secondThird).toHaveCount(0)
  expect(fs.existsSync(oldA)).toBe(true)

  // --- Confirming both dialogs deletes the real JSONL files -----------------
  await page.getByTestId('session-cleanup-execute').click()
  const firstFinal = page.getByRole('dialog')
  await expect(firstFinal).toBeVisible()
  await firstFinal.getByRole('button', { name: /继续|Continue/ }).click()
  const secondFinal = page.getByRole('dialog')
  await expect(secondFinal).toContainText(/无法通过 Pi-Harness 恢复|cannot restore/)
  await secondFinal.getByRole('button', { name: /永久删除|Delete permanently/ }).click()
  const result = page.getByTestId('session-cleanup-result')
  await expect(result).toContainText(/3/)
  expect(fs.existsSync(oldA)).toBe(false)
  expect(fs.existsSync(oldB)).toBe(false)
  expect(fs.existsSync(recentA)).toBe(false)

  // The sidebar reflects the deletion without an app restart.
  await page.locator('a[href="#/workspace"]').click()
  await expect(page.getByText(/Fixture session old-a/)).toHaveCount(0)
  await expect(page.getByText(/Fixture session old-b/)).toHaveCount(0)
  await expect(page.getByText(/Fixture session recent-a/)).toHaveCount(0)
  void electronApp
})

test('deleted sessions stay gone after an application restart', async ({
  page,
  testUserData,
  piAgentDir,
  workspaceRoot,
  electronApp
}, testInfo) => {
  const projectA = path.join(workspaceRoot, 'project-a')
  fs.mkdirSync(projectA, { recursive: true })
  const sessionFile = seedSession(piAgentDir, { id: 'restart-a', cwd: projectA, ageDays: 120 })

  await openSettingsWorkspace(page)
  await chooseScope(page, /全部历史会话|All historical sessions/)
  await page.getByTestId('session-cleanup-scan').click()
  await page.getByTestId('session-cleanup-execute').click()
  const first = page.getByRole('dialog')
  await expect(first).toBeVisible()
  await first.getByRole('button', { name: /继续|Continue/ }).click()
  const second = page.getByRole('dialog')
  await expect(second).toBeVisible()
  await second.getByRole('button', { name: /永久删除|Delete permanently/ }).click()
  await expect(page.getByTestId('session-cleanup-result')).toContainText(/1/)
  expect(fs.existsSync(sessionFile)).toBe(false)
  await electronApp.close()

  // Relaunch against the same user data and agent dir: the history must not return.
  const app2 = await electron.launch({
    executablePath: electronBinary,
    args: process.env.PI_HARNESS_E2E_EXECUTABLE ? [] : [mainJs],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: undefined as unknown as string,
      PI_HARNESS_AGENT_MODE: process.env.PI_HARNESS_E2E_AGENT_MODE ?? 'sdk',
      PI_HARNESS_PI_CLI_PATH: path.join(testUserData, 'missing-pi-cli'),
      PI_HARNESS_PI_CONFIG_DIR: piAgentDir,
      PI_CODING_AGENT_DIR: piAgentDir,
      PI_HARNESS_USER_DATA: testUserData,
      PI_HARNESS_SESSION_HOME: path.join(testUserData, 'history-home'),
      PI_HARNESS_CAPABILITY_FIXTURES_DIR: path.join(root, 'fixtures', 'capabilities'),
      PI_HARNESS_BUILTIN_SKILLS_DIR: path.join(root, 'resources', 'builtin-skills'),
      TMPDIR: os.tmpdir()
    },
    timeout: 60_000
  })
  try {
    const deadline = Date.now() + 60_000
    let page2: Page | undefined
    while (Date.now() < deadline && !page2) {
      page2 = app2.windows().find((candidate) => {
        const url = candidate.url()
        return Boolean(url) && url !== 'about:blank' && !url.includes('overlay.html')
      })
      if (!page2) await new Promise((resolve) => setTimeout(resolve, 50))
    }
    if (!page2) throw new Error('Restarted Pi-Harness main window did not appear')
    await page2.waitForLoadState('domcontentloaded')
    await expect(page2.getByTestId('startup-animation')).toBeHidden({ timeout: 12_000 })
    await page2.locator('a[href="#/workspace"]').click()
    await expect(page2.getByText(/Fixture session restart-a/)).toHaveCount(0)
  } finally {
    await app2.close().catch(() => undefined)
  }
  void testInfo
})

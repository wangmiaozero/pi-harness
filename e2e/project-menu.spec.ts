import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import type { ElectronApplication, Page } from '@playwright/test'
import { test, expect } from './fixtures'

async function chooseAction(app: ElectronApplication, action: string) {
  await app.evaluate(({ Menu }, selected) => {
    Menu.buildFromTemplate = ((items: Electron.MenuItemConstructorOptions[]) => {
      ;(globalThis as unknown as { testedMenu: string[] }).testedMenu = items
        .filter((item) => item.type !== 'separator')
        .map((item) => item.id || String(item.label))
      return {
        popup(options: { callback?: () => void }) {
          items
            .find((item) => item.id === selected)
            ?.click?.({} as Electron.MenuItem, undefined, {} as Electron.KeyboardEvent)
          options.callback?.()
        }
      } as Electron.Menu
    }) as typeof Menu.buildFromTemplate
  }, action)
}

async function menuItems(app: ElectronApplication) {
  return app.evaluate(() => (globalThis as unknown as { testedMenu: string[] }).testedMenu)
}

function seedSession(agentDir: string, cwd: string, id: string, title: string) {
  const dir = path.join(
    agentDir,
    'sessions',
    `--${path
      .resolve(cwd)
      .replace(/^[/\\]/, '')
      .replace(/[/\\:]/g, '-')}--`
  )
  fs.mkdirSync(dir, { recursive: true })
  const timestamp = '2026-08-29T05:00:00.000Z'
  fs.writeFileSync(
    path.join(dir, `2026-08-29T05-00-00-000Z_${id}.jsonl`),
    [
      JSON.stringify({ type: 'session', version: 3, id, timestamp, cwd }),
      JSON.stringify({
        type: 'message',
        id: 'user-1',
        parentId: null,
        timestamp,
        message: { role: 'user', content: title, timestamp: Date.parse(timestamp) }
      })
    ].join('\n') + '\n'
  )
}

async function screenshot(page: Page, name: string) {
  if (process.env.PI_HARNESS_DESIGN_QA_DIR) {
    await page.screenshot({ path: path.join(process.env.PI_HARNESS_DESIGN_QA_DIR, `${name}.png`) })
  }
}

test('project actions belong to the project row; chats only rename and delete', async ({
  page,
  electronApp,
  piAgentDir,
  workspaceRoot
}) => {
  const root = path.join(workspaceRoot, 'skills')
  fs.mkdirSync(root)
  const id = '01a026a4-0796-73ff-990a-a2be219835aa'
  seedSession(piAgentDir, root, id, 'hi')
  await page.setViewportSize({ width: 1200, height: 780 })
  await page.evaluate(() => window.piSwitch.settings.set({ theme: 'light' }))
  await page.locator('a[href="#/workspace"]').click()
  await page.getByTestId('workspace-refresh').click()
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light'
  })
  const project = page.getByTestId('workspace-project-0')
  const session = page.getByTestId(`session-row-${id}`)
  await session.getByRole('button', { name: 'hi', exact: true }).click()
  const plus = project.getByRole('button', {
    name: /新建会话: skills|New Session: skills|New session: skills/
  })
  await expect(plus).toBeVisible()
  await expect(session.locator('[data-testid^="workspace-new-session-"]')).toHaveCount(0)
  const [projectBox, plusBox, sessionBox] = await Promise.all([
    project.boundingBox(),
    plus.boundingBox(),
    session.boundingBox()
  ])
  expect(plusBox!.y).toBeGreaterThanOrEqual(projectBox!.y)
  expect(plusBox!.y + plusBox!.height).toBeLessThanOrEqual(projectBox!.y + projectBox!.height)
  expect(plusBox!.y).toBeLessThan(sessionBox!.y)
  await expect(project).not.toHaveClass(/bg-\[var\(--accent-tint\)\]/)
  await screenshot(page, 'project-row')

  await chooseAction(electronApp, '')
  await project.click({ button: 'right' })
  await expect
    .poll(() => menuItems(electronApp))
    .toEqual([
      'pin',
      'open',
      'edit',
      'rename',
      'archive-chats',
      'create-worktree',
      'export-html',
      'export-md',
      'reveal',
      'remove'
    ])

  await chooseAction(electronApp, 'rename')
  await session.click({ button: 'right' })
  const rename = page.getByRole('dialog', { name: /重命名聊天|Rename chat/ })
  await expect(rename).toBeVisible()
  expect(await menuItems(electronApp)).toEqual(['rename', 'delete'])
  const input = rename.getByTestId('workspace-rename-input')
  await expect(input).toBeFocused()
  expect(
    await input.evaluate(
      (element: HTMLInputElement) => element.selectionEnd! - element.selectionStart!
    )
  ).toBe(2)
  await screenshot(page, 'rename-chat')
  await input.fill('   ')
  await expect(rename.getByTestId('workspace-rename-save')).toBeDisabled()
  await input.fill('renamed chat')
  await input.press('Enter')
  await expect(rename).toHaveCount(0)
  await expect(session).toContainText('renamed chat')
  await expect(page.getByTestId('workspace-tabs')).toContainText('renamed chat')

  await session.click({ button: 'right' })
  await rename.getByTestId('workspace-rename-input').fill('cancelled name')
  await rename.getByRole('button', { name: /取消|Cancel/, exact: true }).click()
  await expect(session).toContainText('renamed chat')
  await chooseAction(electronApp, 'delete')
  await session.click({ button: 'right' })
  await page
    .getByRole('dialog', { name: /删除会话|Delete session/ })
    .getByRole('button', { name: /删除|Delete/, exact: true })
    .click()
  await expect(session).toHaveCount(0)
  await expect(project).toContainText('skills')
  await page.getByTestId('workspace-toggle-files').click()
  await expect(page.getByTestId('workspace-files-unavailable')).toBeVisible()
  // Git reads all workspace projects, so the project stays visible without any session.
  await page.locator('a[href="#/git"]').click()
  await expect(page.getByTestId('git-repository-sidebar')).toContainText('skills')
  await page.locator('a[href="#/workspace"]').click()
})

test('project menu pin, rename, open, reveal, export, archive and remove are scoped', async ({
  page,
  electronApp,
  piAgentDir,
  workspaceRoot
}) => {
  const rootA = path.join(workspaceRoot, 'project-a')
  const rootB = path.join(workspaceRoot, 'project-b')
  fs.mkdirSync(rootA)
  fs.mkdirSync(rootB)
  fs.writeFileSync(path.join(rootA, 'keep.txt'), 'source stays')
  const idA = '01a026a4-0796-73ff-990a-a2be219835ab'
  const idA2 = '01a026a4-0796-73ff-990a-a2be219835ac'
  const idB = '01a026a4-0796-73ff-990a-a2be219835ad'
  seedSession(piAgentDir, rootA, idA, 'only-project-a')
  seedSession(piAgentDir, rootA, idA2, 'second-chat-a')
  seedSession(piAgentDir, rootB, idB, 'only-project-b')
  await page.locator('a[href="#/workspace"]').click()
  await page.getByTestId('workspace-refresh').click()
  const groupA = page
    .getByTestId(/^workspace-project-group-/)
    .filter({ has: page.getByTestId(`session-row-${idA}`) })
  const rowA = groupA.getByTestId(/^workspace-project-\d+$/)
  const rowB = page.getByTestId(/^workspace-project-\d+$/).filter({ hasText: 'project-b' })
  await chooseAction(electronApp, 'pin')
  await rowB.click({ button: 'right' })
  await expect(page.getByTestId('workspace-project-0')).toContainText('project-b')
  await chooseAction(electronApp, 'unpin')
  await rowB.click({ button: 'right' })
  expect(await menuItems(electronApp)).toContain('unpin')
  await chooseAction(electronApp, 'rename')
  await rowA.click({ button: 'right' })
  const rename = page.getByRole('dialog', { name: /重命名项目|Rename project/ })
  await rename.getByTestId('workspace-rename-input').fill('Project Alpha')
  await rename.getByTestId('workspace-rename-save').click()
  await expect(rowA).toContainText('Project Alpha')
  await page.reload()
  await expect(rowA).toContainText('Project Alpha')
  await chooseAction(electronApp, 'open')
  await rowA.click({ button: 'right' })
  await expect(page.getByTestId('workspace-new-session')).toBeEnabled()

  await electronApp.evaluate(({ shell }) => {
    shell.showItemInFolder = (target) => {
      ;(globalThis as unknown as { revealedProject: string }).revealedProject = target
    }
  })
  await chooseAction(electronApp, 'reveal')
  await rowA.click({ button: 'right' })
  await expect
    .poll(() =>
      electronApp.evaluate(
        () => (globalThis as unknown as { revealedProject: string }).revealedProject
      )
    )
    .toBe(fs.realpathSync(rootA))

  for (const format of ['html', 'md']) {
    const output = path.join(workspaceRoot, `project-export.${format}`)
    await electronApp.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath })
    }, output)
    await chooseAction(electronApp, `export-${format}`)
    await rowA.click({ button: 'right' })
    // Creation precedes the async write; wait for content, not just an empty file.
    await expect
      .poll(() => (fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : ''))
      .toContain('second-chat-a')
    const text = fs.readFileSync(output, 'utf8')
    expect(text).toContain('only-project-a')
    expect(text).toContain('second-chat-a')
    expect(text).not.toContain('only-project-b')
  }

  await chooseAction(electronApp, 'archive-chats')
  await rowA.click({ button: 'right' })
  await page
    .getByRole('dialog', { name: /归档聊天|Archive chats/ })
    .getByRole('button', { name: /归档聊天|Archive chats/, exact: true })
    .click()
  await expect(page.getByTestId(`session-row-${idA}`)).toHaveCount(0)
  await expect(page.getByTestId(`session-row-${idA2}`)).toHaveCount(0)
  await expect(page.getByTestId(`session-row-${idB}`)).toBeVisible()
  const renamedProject = page
    .getByTestId(/^workspace-project-\d+$/)
    .filter({ hasText: 'Project Alpha' })
  await expect(renamedProject).toBeVisible()
  await chooseAction(electronApp, 'remove')
  await renamedProject.click({ button: 'right' })
  await page
    .getByRole('dialog', { name: /删除项目|Delete project/ })
    .getByRole('button', { name: /删除|Delete/, exact: true })
    .click()
  await expect(renamedProject).toHaveCount(0)
  expect(fs.readFileSync(path.join(rootA, 'keep.txt'), 'utf8')).toBe('source stays')
  expect(await page.evaluate(() => window.piSwitch.sessions.list(true))).toHaveLength(3)
  await page.reload()
  await expect(renamedProject).toHaveCount(0)
  await expect(page.getByTestId(`session-row-${idB}`)).toBeVisible()
})

test('project branch action creates a permanent worktree in the selected repository', async ({
  page,
  electronApp,
  workspaceRoot
}) => {
  const root = path.join(workspaceRoot, 'repository')
  fs.mkdirSync(root)
  execFileSync('git', ['init', '-b', 'main', root])
  execFileSync('git', [
    '-C',
    root,
    '-c',
    'user.name=wangmiao',
    '-c',
    'user.email=tuziling84@gmail.com',
    'commit',
    '--allow-empty',
    '-m',
    'fixture'
  ])
  await electronApp.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] })
  }, root)
  await page.locator('a[href="#/workspace"]').click()
  await page.getByTestId('workspace-import-project').click()
  await chooseAction(electronApp, 'create-worktree')
  await page.getByTestId('workspace-project-0').click({ button: 'right' })
  const create = page.getByRole('dialog', { name: /创建分支|Create branch/ })
  await create.getByTestId('project-branch-name').fill('feature-test')
  await create.getByRole('button', { name: /新建|Create/, exact: true }).click()
  await expect(create).toHaveCount(0)
  await expect(page.getByTestId('workspace-project-1')).toContainText('feature-test')
  const worktrees = execFileSync('git', ['-C', root, 'worktree', 'list', '--porcelain'], {
    encoding: 'utf8'
  })
  expect(worktrees).toContain('refs/heads/feature-test')
  expect(worktrees).toContain(`${root}-worktrees/feature-test`)
})

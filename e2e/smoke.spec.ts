import path from 'node:path'
import fs from 'node:fs'
import { test, expect } from './fixtures'

test.describe('Pi-Harness smoke', () => {
  test('launches and shows overview', async ({ page }) => {
    await expect(page.getByText('Pi-Harness').first()).toBeVisible({ timeout: 30_000 })
    // zh-CN default label for Overview is 「概览」
    await expect(page.locator('a[href="#/"]').filter({ hasText: /概览|Overview/ })).toBeVisible()
    await expect(page.getByTestId('page-mascot-background')).toHaveCount(0)
  })

  test('navigates every primary page with the default mascot hidden', async ({
    electronApp,
    page
  }) => {
    if (process.env.PI_HARNESS_DESIGN_QA_DIR) {
      await page.setViewportSize({ width: 1200, height: 780 })
    }
    const pageErrors: string[] = []
    const consoleErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    await expect(page.getByText('Pi-Harness').first()).toBeVisible({ timeout: 30_000 })
    await expect
      .poll(() => electronApp.evaluate(({ nativeTheme }) => nativeTheme.themeSource))
      .toBe('dark')
    await page.evaluate(() => window.piSwitch.settings.set({ theme: 'light' }))
    await expect
      .poll(() => electronApp.evaluate(({ nativeTheme }) => nativeTheme.themeSource))
      .toBe('light')
    await page.evaluate(() => window.piSwitch.settings.set({ theme: 'dark' }))
    await expect
      .poll(() => electronApp.evaluate(({ nativeTheme }) => nativeTheme.themeSource))
      .toBe('dark')
    if (process.env.PI_HARNESS_DESIGN_QA_DIR) {
      await page.evaluate(() => window.piSwitch.settings.set({ theme: 'light' }))
      await page.evaluate(() => {
        document.documentElement.dataset.theme = 'light'
      })
    }

    await page.evaluate(async () => {
      const sessionProjects = (await window.piSwitch.sessions.list())
        .map((session) => session.projectKey)
        .filter((projectKey): projectKey is string => Boolean(projectKey))
      localStorage.setItem(
        'pi-harness.workspace.v1',
        JSON.stringify({
          projectKey: null,
          pickedCwd: null,
          projectRoots: [],
          removedProjectKeys: [...new Set(sessionProjects)],
          tabs: [],
          activeTabId: null
        })
      )
    })
    await page.locator('a[href="#/workspace"]').click()
    await expect(page.getByTestId('page-mascot-background')).toHaveCount(0)
    await expect(page.locator('main aside')).toBeVisible()
    await expect(page.getByTestId('workspace-project-required')).toBeVisible()
    await expect(page.getByTestId('workspace-new-session')).toBeDisabled()
    await expect(page.getByTestId('workspace-import-workspace')).not.toHaveAttribute(
      'aria-haspopup',
      /.+/
    )
    await expect(page.getByTestId('workspace-import-menu')).toHaveCount(0)
    await page.getByTestId('workspace-refresh').click()
    await expect(page.getByTestId('workspace-refresh')).toBeEnabled()
    await expect(page.getByTestId('workspace-toggle-files')).toBeVisible()
    await expect(page.getByTestId('workspace-section-files')).toHaveCount(0)
    await expect(page.getByTestId('workspace-tabs')).toHaveCount(0)
    await expect(page.locator('main textarea')).toHaveCount(0)
    await expect(
      page
        .getByTestId('workspace-project-required')
        .getByRole('button', { name: /打开项目|Open project/ })
    ).toBeVisible()
    const workspaceSidebar = page.getByTestId('workspace-sidebar')
    await workspaceSidebar.evaluate((element) => {
      const transfer = new DataTransfer()
      transfer.items.add(new File(['project'], 'project-folder'))
      element.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: transfer }))
    })
    await expect(page.getByTestId('project-drop-overlay')).toBeVisible()
    await workspaceSidebar.dispatchEvent('dragleave')
    await expect(page.getByTestId('project-drop-overlay')).toHaveCount(0)
    await page.getByTestId('workspace-toggle-files').click()
    await expect(page.getByTestId('workspace-files-unavailable')).toBeVisible()
    await expect(page.getByTestId('workspace-files-unavailable').getByRole('button')).toHaveCount(0)
    if (process.env.PI_HARNESS_DESIGN_QA_DIR) {
      await page.screenshot({
        path: path.join(process.env.PI_HARNESS_DESIGN_QA_DIR, 'workspace-no-session.png')
      })
    }
    await workspaceSidebar.getByRole('button', { name: /Harness/ }).click()
    await expect(page.getByTestId('harness-console')).toBeVisible()
    await expect(page.getByText(/尚未选择会话|No session selected/)).toBeVisible()
    await expect(page.getByTestId('workspace-tabs')).toBeVisible()

    await page.locator('a[href="#/providers"]').click()
    await expect(page.locator('h1').filter({ hasText: /提供商|Providers/ })).toBeVisible()
    await expect(page.getByTestId('page-mascot-background')).toHaveCount(0)
    const providerSwitches = page.locator('main [role="switch"]')
    await expect(providerSwitches).toHaveCount(2)
    await expect
      .poll(() =>
        providerSwitches.evaluateAll(
          (switches) =>
            switches.filter((item) => item.getAttribute('aria-checked') === 'true').length
        )
      )
      .toBe(1)

    await page.locator('a[href="#/models"]').click()
    await expect(page.locator('h1').filter({ hasText: /模型|Models/ })).toBeVisible()
    await expect(page.getByTestId('page-mascot-background')).toHaveCount(0)

    await page.locator('a[href="#/settings"]').click()
    await expect(page.locator('h1').filter({ hasText: /设置|Settings/ })).toBeVisible()
    await expect(page.getByTestId('page-mascot-background')).toHaveCount(0)
    if (process.env.PI_HARNESS_DESIGN_QA_DIR) {
      await page.screenshot({
        path: path.join(process.env.PI_HARNESS_DESIGN_QA_DIR, 'settings-home.png')
      })
    }

    await expect(page.locator('a[href="#/config"]')).toHaveCount(0)
    await expect(page.locator('a[href="#/diagnostics"]')).toHaveCount(0)
    await page.getByTestId('settings-section-config').click()
    await expect(page.getByText(/models\.json/i).first()).toBeVisible()
    await expect(page.getByTestId('page-mascot-background')).toHaveCount(0)

    await page.locator('a[href="#/skills"]').click()
    await expect(page.getByTestId('page-mascot-background')).toHaveCount(0)

    await page.locator('a[href="#/settings"]').click()
    await page.getByTestId('settings-section-diagnostics').click()
    await expect(page.getByTestId('page-mascot-background')).toHaveCount(0)

    await page.locator('a[href="#/"]').click()
    await expect(page.getByTestId('page-mascot-background')).toHaveCount(0)

    expect(pageErrors).toEqual([])
    expect(consoleErrors).toEqual([])
  })

  test('restores no stale draft, reacts to project import, and hides Git without a session', async ({
    page,
    electronApp,
    workspaceRoot
  }) => {
    if (process.env.PI_HARNESS_DESIGN_QA_DIR) {
      await page.setViewportSize({ width: 1200, height: 780 })
      await page.evaluate(() => window.piSwitch.settings.set({ theme: 'light' }))
      await page.evaluate(() => {
        document.documentElement.dataset.theme = 'light'
      })
    }
    const draftRoot = path.resolve(import.meta.dirname, '../fixtures')
    await page.evaluate(
      async ({ root }) => {
        await window.piSwitch.workspace.allowRoot(root)
        localStorage.setItem(
          'pi-harness.workspace.v1',
          JSON.stringify({
            projectKey: null,
            pickedCwd: root,
            projectRoots: [root],
            tabs: [
              {
                id: 'harness',
                kind: 'harness',
                title: 'Harness 控制台',
                closable: true
              }
            ],
            activeTabId: 'harness'
          })
        )
      },
      { root: draftRoot }
    )

    await page.locator('a[href="#/workspace"]').click()
    await expect(page.getByTestId('harness-console')).toBeVisible()
    await expect(page.getByText(/尚未选择会话|No session selected/)).toBeVisible()
    const sessionTree = page.getByTestId('workspace-session-tree')
    await expect(page.getByTestId('workspace-draft-session')).toHaveCount(0)
    await expect(sessionTree.getByText('fixtures', { exact: true })).toHaveCount(0)
    await expect(sessionTree.getByText(/暂无项目|No projects/)).toBeVisible()
    await expect(page.getByTestId('workspace-section-sessions')).toHaveText(/项目|Projects/)

    await page.getByTestId('workspace-section-git').click()
    await expect(page.getByTestId('workspace-git-unavailable')).toBeVisible()
    await expect(page.getByTestId('workspace-git-unavailable')).toContainText(
      /选择或创建会话后查看 Git 状态|Select or create a session to view Git status/
    )

    const importedProject = path.join(workspaceRoot, 'explicit-project')
    fs.mkdirSync(importedProject, { recursive: true })
    await electronApp.evaluate(({ dialog }, picked) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] })
    }, importedProject)
    await page.getByTestId('workspace-section-sessions').click()
    await page.getByTestId('workspace-import-project').click()
    await expect(page.getByTestId('workspace-project-0')).toContainText('explicit-project')
    await expect(sessionTree.getByText(/待创建会话|Pending session/)).toHaveCount(0)
    await expect(sessionTree.locator('[data-testid^="session-row-"]')).toHaveCount(0)

    if (process.env.PI_HARNESS_DESIGN_QA_DIR) {
      await page.screenshot({
        path: path.join(process.env.PI_HARNESS_DESIGN_QA_DIR, 'workspace-imported-project.png')
      })
    }

    // Explicit project entries survive restart, but cannot restore a phantom session or Git source.
    await page.reload()
    await expect(page.getByTestId('workspace-project-0')).toContainText('explicit-project')
    await expect(page.getByTestId('workspace-draft-session')).toHaveCount(0)
    await page.getByTestId('workspace-toggle-files').click()
    await expect(page.getByTestId('workspace-files-unavailable')).toBeVisible()
    await page.getByTestId('workspace-section-git').click()
    await expect(page.getByTestId('workspace-git-unavailable')).toBeVisible()
    await page.getByTestId('workspace-section-sessions').click()
    await electronApp.evaluate(({ Menu }) => {
      Menu.buildFromTemplate = ((template: Electron.MenuItemConstructorOptions[]) =>
        ({
          popup: (options: { callback?: () => void }) => {
            template
              .find((item) => item.id === 'remove')
              ?.click?.({} as Electron.MenuItem, undefined, {} as Electron.KeyboardEvent)
            options.callback?.()
          }
        }) as Electron.Menu) as typeof Menu.buildFromTemplate
    })
    await page.getByTestId('workspace-project-0').click({ button: 'right' })
    await page
      .getByRole('dialog', { name: /删除项目|Delete project/ })
      .getByRole('button', { name: /删除|Delete/, exact: true })
      .click()
    await expect(page.getByTestId('workspace-draft-session')).toHaveCount(0)
    await expect(sessionTree.getByText(/暂无项目|No projects/)).toBeVisible()
    await page.getByTestId('workspace-section-git').click()
    await expect(page.getByTestId('workspace-git-unavailable')).toBeVisible()
    if (process.env.PI_HARNESS_DESIGN_QA_DIR) {
      await page.screenshot({
        path: path.join(process.env.PI_HARNESS_DESIGN_QA_DIR, 'workspace-git-empty.png')
      })
    }
  })

  test('groups conversations under projects when importing projects and workspaces', async ({
    page,
    electronApp,
    piAgentDir,
    workspaceRoot
  }) => {
    if (process.env.PI_HARNESS_DESIGN_QA_DIR) {
      await page.setViewportSize({ width: 1200, height: 780 })
      await page.evaluate(() => window.piSwitch.settings.set({ theme: 'light' }))
      await page.evaluate(() => {
        document.documentElement.dataset.theme = 'light'
      })
    }
    const pageErrors: string[] = []
    const consoleErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })

    const projectA = path.join(workspaceRoot, 'import-a')
    const projectB = path.join(workspaceRoot, 'import-b')
    const projectC = path.join(workspaceRoot, 'import-c')
    for (const dir of [projectA, projectB, projectC]) fs.mkdirSync(dir, { recursive: true })
    const sessionA1 = '01a026a4-0796-73ff-990a-a2be2198354a'
    const sessionA2 = '01a026a4-0796-73ff-990a-a2be2198354b'
    const sessionB = '01a026a4-0796-73ff-990a-a2be2198354c'
    seedSession(piAgentDir, projectA, sessionA1, `Session ${sessionA1}`)
    seedSession(piAgentDir, projectA, sessionA2, `Session ${sessionA2}`)
    seedSession(piAgentDir, projectB, sessionB, `Session ${sessionB}`)

    await page.evaluate(() => localStorage.removeItem('pi-harness.workspace.v1'))
    await page.locator('a[href="#/workspace"]').click()
    const tree = page.getByTestId('workspace-session-tree')
    await expect(tree).toBeVisible()

    const pickDirectory = (dir: string) =>
      electronApp.evaluate(({ dialog }, picked) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] })
      }, dir)

    await pickDirectory(projectA)
    await page.getByTestId('workspace-import-project').click()
    await expect(page.locator('main textarea')).toBeVisible()
    await expect(page.getByTestId('workspace-project-0')).toContainText('import-a')
    await expect(page.getByTestId('workspace-draft-session')).toHaveCount(0)
    const groupA = page.getByTestId('workspace-project-group-0')
    await expect(groupA.getByText(`Session ${sessionA1}`)).toBeVisible()
    await expect(groupA.getByText(`Session ${sessionA2}`)).toBeVisible()
    await expect(groupA.getByText(`Session ${sessionB}`)).toHaveCount(0)
    await expect(tree.getByText(`Session ${sessionB}`)).toBeVisible()

    await pickDirectory(projectB)
    await page.getByTestId('workspace-import-workspace').click()
    await expect(page.getByTestId('workspace-project-1')).toContainText('import-b')
    await expect.poll(() => tree.innerText()).toContain(`Session ${sessionB}`)
    await expect(tree.getByText(`Session ${sessionA1}`)).toBeVisible()
    await expect(tree.getByText(`Session ${sessionA2}`)).toBeVisible()

    // A session created on disk after launch shows up right after import, without a manual refresh.
    const sessionC = '01a026a4-0796-73ff-990a-a2be2198354d'
    seedSession(piAgentDir, projectC, sessionC, `Session ${sessionC}`)
    await pickDirectory(projectC)
    await page.getByTestId('workspace-import-project').click()
    await expect.poll(() => tree.innerText()).toContain(`Session ${sessionC}`)
    await expect(tree.getByText(`Session ${sessionA1}`)).toBeVisible()
    await expect(tree.getByText(`Session ${sessionA2}`)).toBeVisible()

    // Importing a project never filters the complete Codex-style session list.
    const projectD = path.join(workspaceRoot, 'import-d')
    fs.mkdirSync(projectD, { recursive: true })
    await pickDirectory(projectD)
    await page.getByTestId('workspace-import-project').click()
    await expect(tree.getByText(`Session ${sessionA1}`)).toBeVisible()
    await expect(tree.getByText(`Session ${sessionB}`)).toBeVisible()
    await expect(tree.getByText(`Session ${sessionC}`)).toBeVisible()
    await expect(page.getByTestId('workspace-new-session')).toBeDisabled()

    const projectE = path.join(workspaceRoot, 'import-e')
    fs.mkdirSync(projectE, { recursive: true })
    await pickDirectory(projectE)
    await page.getByTestId('workspace-import-project').click()
    await expect(page.getByTestId('workspace-project-3')).toContainText('import-d')
    await expect(page.getByTestId('workspace-project-4')).toContainText('import-e')
    await expect(tree.getByText(/待创建会话|Pending session/)).toHaveCount(0)

    const workspaceFile = path.join(workspaceRoot, 'combined.code-workspace')
    fs.writeFileSync(
      workspaceFile,
      JSON.stringify({ folders: [{ path: projectD }, { path: projectE }] })
    )
    await pickDirectory(workspaceFile)
    await page.getByTestId('workspace-import-workspace').click()
    await expect(tree.locator('[data-testid^="workspace-project-group-"]')).toHaveCount(5)
    await expect(page.getByTestId('workspace-project-3')).toContainText('combined')
    // A previously imported standalone project is not removed when used as a source folder.
    await expect(page.getByTestId('workspace-project-4')).toContainText('import-e')
    await expect
      .poll(() =>
        page.evaluate(async () => (await window.piSwitch.workspace.getActive()).folders.length)
      )
      .toBe(2)

    if (process.env.PI_HARNESS_DESIGN_QA_DIR) {
      await page.screenshot({
        path: path.join(process.env.PI_HARNESS_DESIGN_QA_DIR, 'workspace-project-tree.png')
      })
    }

    expect(pageErrors).toEqual([])
    expect(consoleErrors).toEqual([])
  })

  test('edits project sources for new chats and keeps existing session attachments isolated', async ({
    page,
    electronApp,
    piAgentDir,
    workspaceRoot
  }) => {
    if (process.env.PI_HARNESS_DESIGN_QA_DIR) {
      await page.setViewportSize({ width: 1869, height: 1050 })
      await page.evaluate(() => window.piSwitch.settings.set({ theme: 'light' }))
      await page.evaluate(() => {
        document.documentElement.dataset.theme = 'light'
      })
    }
    const primary = path.join(workspaceRoot, 'session-primary')
    const secondary = path.join(workspaceRoot, 'session-secondary')
    const added = path.join(workspaceRoot, 'session-added')
    for (const dir of [primary, secondary, added]) fs.mkdirSync(dir, { recursive: true })
    const sessionId = '01a026a4-0796-73ff-990a-a2be2198354e'
    seedSession(piAgentDir, primary, sessionId, 'Multi-project session')

    await page.evaluate(
      async ({ selectedSessionId, primaryRoot, secondaryRoot }) => {
        await window.piSwitch.workspace.allowRoot(primaryRoot)
        await window.piSwitch.workspace.allowRoot(secondaryRoot)
        await window.piSwitch.workspace.bindSession(
          selectedSessionId,
          `session:${selectedSessionId}`,
          [
            { id: primaryRoot, path: primaryRoot, role: 'main' },
            { id: secondaryRoot, path: secondaryRoot, role: 'reference' }
          ],
          primaryRoot
        )
      },
      { selectedSessionId: sessionId, primaryRoot: primary, secondaryRoot: secondary }
    )

    await page.locator('a[href="#/workspace"]').click()
    await page.getByTestId('workspace-refresh').click()
    const sessionRow = page.getByTestId(`session-row-${sessionId}`)
    await expect(sessionRow).toContainText('Multi-project session')
    await expect(page.locator(`[data-testid^="session-project-${sessionId}-"]`)).toHaveCount(2)

    await electronApp.evaluate(({ Menu }) => {
      Menu.buildFromTemplate = ((template: Electron.MenuItemConstructorOptions[]) =>
        ({
          popup: (options: { callback?: () => void }) => {
            const item = template.find((candidate) =>
              ['编辑', 'Edit'].includes(String(candidate.label))
            )
            item?.click?.({} as Electron.MenuItem, undefined, {} as Electron.KeyboardEvent)
            options.callback?.()
          }
        }) as Electron.Menu) as typeof Menu.buildFromTemplate
    })
    await page.getByTestId('workspace-project-0').click({ button: 'right' })

    const editor = page.getByRole('dialog', { name: /编辑项目|Edit project/ })
    await expect(editor).toBeVisible()
    await expect(editor.getByTestId(/^session-workspace-folder-/)).toHaveCount(2)
    await electronApp.evaluate(({ dialog }, selected) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] })
    }, added)
    await editor.getByTestId('session-workspace-add-folder').click()
    await expect(editor.getByText('session-added', { exact: true })).toBeVisible()
    await editor
      .getByRole('button', { name: /移除: session-secondary|Remove: session-secondary/ })
      .click()
    await expect(editor.getByText('session-secondary', { exact: true })).toHaveCount(0)
    if (process.env.PI_HARNESS_DESIGN_QA_DIR) {
      await page.screenshot({
        path: path.join(process.env.PI_HARNESS_DESIGN_QA_DIR, 'session-workspace-editor.png')
      })
    }
    await editor.getByTestId('session-workspace-save').click()
    await expect(editor).toHaveCount(0)
    await expect(page.locator(`[data-testid^="session-project-${sessionId}-"]`)).toHaveCount(2)
    await expect(page.getByTestId(`session-project-${sessionId}-1`)).toContainText(
      'session-secondary'
    )

    await page.getByTestId('workspace-new-project-session-0').click()
    await expect
      .poll(() =>
        page.evaluate(async () =>
          (await window.piSwitch.workspace.getActive())?.folders.map((folder) => folder.name)
        )
      )
      .toEqual(['session-primary', 'session-added'])
    await expect(page.locator('main textarea')).toBeVisible()
    await expect(page.getByTestId('workspace-new-session')).toBeDisabled()
    // Session attachments stay under their session; creating another chat cannot promote them to projects.
    await expect(
      page.getByTestId('workspace-session-tree').getByTestId(/^workspace-project-group-/)
    ).toHaveCount(1)

    await electronApp.evaluate(({ Menu }) => {
      Menu.buildFromTemplate = ((template: Electron.MenuItemConstructorOptions[]) =>
        ({
          popup: (options: { callback?: () => void }) => {
            const item = template.find((candidate) =>
              ['移除', 'Remove'].includes(String(candidate.label))
            )
            item?.click?.({} as Electron.MenuItem, undefined, {} as Electron.KeyboardEvent)
            options.callback?.()
          }
        }) as Electron.Menu) as typeof Menu.buildFromTemplate
    })
    await page.getByTestId(`session-project-${sessionId}-1`).click({ button: 'right' })
    const confirm = page.getByRole('dialog', { name: /移除|Remove/ })
    await confirm.getByRole('button', { name: /移除|Remove/, exact: true }).click()
    await expect(page.locator(`[data-testid^="session-project-${sessionId}-"]`)).toHaveCount(0)
    await expect(sessionRow).toBeVisible()
  })

  test('opens only the selected session project in the Workspace code viewer', async ({
    page,
    piAgentDir
  }) => {
    if (process.env.PI_HARNESS_DESIGN_QA_DIR) {
      await page.setViewportSize({ width: 1200, height: 780 })
      await page.evaluate(() => window.piSwitch.settings.set({ theme: 'light' }))
      await page.evaluate(() => {
        document.documentElement.dataset.theme = 'light'
      })
    }
    const pageErrors: string[] = []
    const consoleErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })

    const fixtureRoot = path.resolve(import.meta.dirname, '../fixtures')
    const sessionId = '01a026a4-0796-73ff-990a-a2be2198353c'
    seedSession(piAgentDir, fixtureRoot, sessionId)
    await page.evaluate(
      async ({ root, selectedSessionId }) => {
        await window.piSwitch.workspace.allowRoot(root)
        localStorage.setItem(
          'pi-harness.workspace.v1',
          JSON.stringify({
            projectKey: null,
            pickedCwd: null,
            projectRoots: [],
            tabs: [
              {
                id: `chat:${selectedSessionId}`,
                kind: 'chat',
                title: 'Fixture session',
                sessionId: selectedSessionId,
                closable: false
              }
            ],
            activeTabId: `chat:${selectedSessionId}`
          })
        )
      },
      { root: fixtureRoot, selectedSessionId: sessionId }
    )

    await page.locator('a[href="#/workspace"]').click()
    const projectTree = page.getByTestId('workspace-session-tree')
    await expect(projectTree.getByText('fixtures', { exact: true })).toBeVisible()
    await expect(page.getByTestId('workspace-toggle-files')).toBeVisible()
    // Restoring a real selected session enables new chat after hydration completes.
    await expect(page.getByTestId('workspace-new-session')).toBeEnabled()
    if (process.env.PI_HARNESS_DESIGN_QA_DIR) {
      await page.screenshot({
        path: path.join(process.env.PI_HARNESS_DESIGN_QA_DIR, 'workspace-selected-session.png')
      })
    }
    const composer = page.locator('main textarea')
    await expect(composer).toBeVisible()
    await expect(page.getByTestId('workspace-mascot')).toHaveCount(0)
    await composer.focus()
    const modelSelect = page.getByTestId('workspace-model-select').getByRole('button')
    await modelSelect.click()
    const modelPanel = page.getByRole('listbox')
    await expect(modelPanel).toBeVisible()
    const [modelSelectBox, modelPanelBox] = await Promise.all([
      modelSelect.boundingBox(),
      modelPanel.boundingBox()
    ])
    expect(modelSelectBox).not.toBeNull()
    expect(modelPanelBox).not.toBeNull()
    expect(
      Math.abs(modelSelectBox!.y - (modelPanelBox!.y + modelPanelBox!.height))
    ).toBeLessThanOrEqual(6)
    await page.keyboard.press('Escape')
    await expect(modelPanel).toBeHidden()
    const aiMotion = page.getByTestId('ai-motion-border')
    await expect(aiMotion).toHaveClass(/opacity-0/)
    await expect(aiMotion.locator('canvas')).toHaveCount(0)
    await expect
      .poll(() =>
        aiMotion.evaluate((element) => {
          const rect = element.getBoundingClientRect()
          return (
            Math.abs(rect.left) < 1 &&
            Math.abs(rect.top) < 1 &&
            Math.abs(rect.width - window.innerWidth) < 1 &&
            Math.abs(rect.height - window.innerHeight) < 1
          )
        })
      )
      .toBe(true)

    const chatScroller = page.getByTestId('chat-scroller')
    await chatScroller.evaluate((element) => {
      const filler = document.createElement('div')
      filler.dataset.scrollTestFiller = ''
      filler.style.height = '2000px'
      element.firstElementChild?.appendChild(filler)
    })
    await expect
      .poll(() =>
        chatScroller.evaluate(
          (element) => element.scrollHeight - element.clientHeight - element.scrollTop
        )
      )
      .toBeLessThanOrEqual(1)
    await page.getByTestId('chat-scroll-top').click()
    await expect
      .poll(() => chatScroller.evaluate((element) => element.scrollTop))
      .toBeLessThanOrEqual(1)
    await expect(page.getByTestId('chat-scroll-bottom')).toBeVisible()
    await page.getByTestId('chat-scroll-bottom').click()
    await expect
      .poll(() =>
        chatScroller.evaluate(
          (element) => element.scrollHeight - element.clientHeight - element.scrollTop
        )
      )
      .toBeLessThanOrEqual(1)
    await chatScroller.evaluate((element) => {
      element.querySelector('[data-scroll-test-filler]')?.remove()
    })

    await page.getByTestId('workspace-toggle-files').click()
    await expect(projectTree).toBeVisible()
    await expect(page.locator('main textarea')).toBeVisible()
    await expect(aiMotion).toHaveClass(/opacity-0/)
    if (process.env.PI_HARNESS_DESIGN_QA_DIR) {
      await page.screenshot({
        path: path.join(
          process.env.PI_HARNESS_DESIGN_QA_DIR,
          'workspace-selected-session-files.png'
        )
      })
    }
    await page.getByRole('button', { name: 'code-preview.html', exact: true }).click()

    const code = page.getByTestId('file-code-view')
    await expect(code).toBeVisible()
    await expect(code.locator('.cm-content')).toContainText('const answer = 42')
    await expect(code.locator('.cm-gutterElement')).not.toHaveCount(0)
    await expect(page.getByText(/15 行|15 lines/)).toBeVisible()

    await page
      .getByTestId('workspace-file-tree')
      .getByRole('button', { name: 'README.md', exact: true })
      .click()
    const tabs = page.getByTestId('workspace-file-tabs')
    await tabs
      .getByRole('button', { name: 'code-preview.html', exact: true })
      .click({ button: 'right' })

    const menu = page.getByTestId('tab-context-menu')
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: '关闭', exact: true })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: '关闭其他', exact: true })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: '关闭右侧标签页', exact: true })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: '关闭左侧标签页', exact: true })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: '全部关闭', exact: true })).toBeVisible()

    await menu.getByRole('menuitem', { name: '关闭其他', exact: true }).click()
    await expect(tabs.getByRole('button')).toHaveCount(1)
    await expect(tabs.getByRole('button', { name: 'code-preview.html', exact: true })).toBeVisible()
    await expect(code.locator('.cm-content')).toContainText('const answer = 42')
    await expect(page.getByTestId('workspace-tabs').getByRole('button')).toHaveCount(1)
    await expect(projectTree).toBeVisible()
    await expect(page.locator('main textarea')).toBeVisible()
    if (process.env.PI_HARNESS_DESIGN_QA_DIR) {
      await page.screenshot({
        path: path.join(process.env.PI_HARNESS_DESIGN_QA_DIR, 'workspace-file-panel-preview.png')
      })
    }
    await page.getByTestId('workspace-collapse-files').click()
    await expect(page.getByTestId('workspace-files-panel')).toHaveCount(0)
    await page.getByTestId('workspace-toggle-files').click()
    await expect(code.locator('.cm-content')).toContainText('const answer = 42')
    expect(pageErrors).toEqual([])
    expect(consoleErrors).toEqual([])
  })

  test('switches mascot styles and keeps starship composer controls compact', async ({
    page,
    electronApp
  }) => {
    const pageErrors: string[] = []
    const consoleErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })

    await page.setViewportSize({ width: 1728, height: 1084 })
    const fixtureRoot = path.resolve(import.meta.dirname, '../fixtures')

    await page.locator('a[href="#/settings"]').click()
    await expect(page.getByTestId('page-header')).toHaveCSS('height', '44px')
    const bypass = await page.evaluate(() =>
      window.piSwitch.settings.set({
        mascotUnlocked: true,
        mascotStyle: 'office',
        petEnabled: true
      })
    )
    expect(bypass).toMatchObject({
      mascotUnlocked: false,
      mascotStyle: 'none',
      petEnabled: false
    })
    await page.getByTestId('settings-section-mascot').click()
    const answer = page.getByTestId('mascot-unlock-answer')
    await expect(answer).toBeVisible()
    await answer.fill('1000')
    await page.getByRole('button', { name: /解锁|Unlock/, exact: true }).click()
    await expect(page.getByRole('alert')).toContainText(/答案不正确|Incorrect answer/)
    await expect(page.getByRole('button', { name: /无看板娘|No Mascot/ })).toHaveCount(0)
    await answer.fill('1024')
    await page.getByRole('button', { name: /解锁|Unlock/, exact: true }).click()
    await expect(page.getByText(/看板娘设置已解锁|Mascot settings unlocked/)).toBeVisible()
    await expect(page.getByRole('button', { name: /无看板娘|No Mascot/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await expect(page.getByRole('button', { name: /长发御姐|Long-haired Executive/ })).toHaveCount(
      0
    )
    await expect(
      page.getByRole('button', { name: /女仆风格（白丝）|Maid Style \(White Stockings\)/ })
    ).toHaveCount(1)
    await expect(page.getByText(/优先推荐|Priority/, { exact: true })).toHaveCount(0)
    const maidWhite = page.getByRole('button', {
      name: /女仆风格（白丝）|Maid Style \(White Stockings\)/
    })
    await maidWhite.click()
    await expect(maidWhite).toHaveAttribute('aria-pressed', 'true')
    await page
      .getByRole('button', { name: /职场风格（黑丝）|Office Style \(Black Tights\)/ })
      .click()
    await page.getByRole('switch', { name: /显示宠物|Show pet/ }).click()
    await page.getByRole('switch', { name: /启用动画|Animations/ }).click()
    await page.getByRole('button', { name: /保存|Save/, exact: true }).click()
    await expect(page.getByText(/设置已保存|Settings saved/)).toBeVisible()
    await expect(page.getByTestId('page-mascot-background')).toHaveAttribute('data-style', 'office')

    await page.locator('a[href="#/workspace"]').click()
    await electronApp.evaluate(({ dialog }, picked) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] })
    }, fixtureRoot)
    await page.getByTestId('workspace-import-project').click()
    await expect(page.getByTestId('page-mascot-background')).toHaveAttribute('data-style', 'office')
    await expect(page.getByTestId('workspace-mascot')).toBeVisible()
    await expect(page.getByTestId('workspace-mascot')).toHaveAttribute('data-style', 'office')
    await expect(page.getByTestId('workspace-mascot')).toHaveAttribute('data-state', 'idle')
    await expect(page.getByTestId('pet-status-bubble')).toContainText(/待机|Idle/)
    await expect(page.getByTestId('workspace-mascot').locator('.pet-renderer')).toHaveClass(
      /pet-motion-off/
    )

    await page.locator('a[href="#/settings"]').click()
    await page.getByTestId('settings-section-mascot').click()
    await page
      .getByRole('button', { name: /星际驾驶舱 · 霜蓝导航员|Starship Cockpit · Frost Navigator/ })
      .click()
    await page.getByRole('button', { name: /保存|Save/, exact: true }).click()
    await page.locator('a[href="#/workspace"]').click()
    await expect
      .poll(() => page.locator('html').getAttribute('data-visual-skin'))
      .toBe('starship-cockpit')
    const cockpitInterior = page.getByTestId('starship-cockpit-interior')
    await expect(cockpitInterior).toBeVisible()
    await expect(cockpitInterior.locator('img')).toHaveJSProperty('naturalWidth', 1672)
    const layerOrder = await page.evaluate(() => ({
      cockpit: Number(
        getComputedStyle(document.querySelector('[data-testid="starship-cockpit-interior"]')!)
          .zIndex
      ),
      mascot: Number(
        getComputedStyle(document.querySelector('[data-testid="page-mascot-background"]')!).zIndex
      )
    }))
    expect(layerOrder.mascot).toBeGreaterThan(layerOrder.cockpit)
    await expect(page.getByTestId('workspace-new-session')).toBeDisabled()
    await expect(page.getByTestId('workspace-tabs')).toHaveCSS('height', '44px')
    await expect(
      page.getByTestId('workspace-sidebar').locator('.mission-control-header')
    ).toHaveCSS('height', '44px')

    const composerMetrics = await page.getByTestId('chat-composer').evaluate((composer) => {
      const input = composer.querySelector<HTMLElement>('.command-console-input')
      const send = composer.querySelector<HTMLElement>('.command-execute-button')
      if (!input || !send) throw new Error('Composer controls are missing')
      const composerBox = composer.getBoundingClientRect()
      const inputBox = input.getBoundingClientRect()
      const sendBox = send.getBoundingClientRect()
      return {
        inputHeight: inputBox.height,
        controlsAreaHeight: composerBox.bottom - inputBox.bottom,
        sendHeight: sendBox.height
      }
    })
    expect(composerMetrics.sendHeight).toBeLessThanOrEqual(36)
    expect(composerMetrics.controlsAreaHeight).toBeLessThan(composerMetrics.inputHeight)
    expect(pageErrors).toEqual([])
    expect(consoleErrors).toEqual([])
  })

  test('edits, saves, and protects externally changed text files', async ({
    page,
    workspaceRoot,
    piAgentDir
  }) => {
    const tempRoot = path.join(workspaceRoot, 'editor')
    const sessionId = '01a026a4-0796-73ff-990a-a2be21983540'
    fs.mkdirSync(tempRoot)
    const filePath = path.join(tempRoot, 'editable.ts')
    fs.mkdirSync(path.join(tempRoot, 'node_modules'))
    fs.writeFileSync(path.join(tempRoot, '.env'), 'TOKEN=test\n')
    fs.writeFileSync(filePath, 'export const value = 1\n')
    seedSession(piAgentDir, tempRoot, sessionId)

    try {
      await page.evaluate(
        async ({ root, selectedSessionId }) => {
          await window.piSwitch.workspace.allowRoot(root)
          localStorage.setItem(
            'pi-harness.workspace.v1',
            JSON.stringify({
              projectKey: null,
              pickedCwd: null,
              projectRoots: [],
              tabs: [
                {
                  id: `chat:${selectedSessionId}`,
                  kind: 'chat',
                  title: 'Editor fixture session',
                  sessionId: selectedSessionId,
                  closable: false
                }
              ],
              activeTabId: `chat:${selectedSessionId}`
            })
          )
        },
        { root: tempRoot, selectedSessionId: sessionId }
      )

      await page.locator('a[href="#/workspace"]').click()
      await page.getByTestId('workspace-toggle-files').click()
      await expect(page.getByRole('button', { name: 'node_modules', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: '.env', exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'editable.ts', exact: true }).click()

      const editor = page.getByTestId('file-code-view').locator('.cm-content')
      await expect(editor).toHaveAttribute('contenteditable', 'true')
      await editor.click()
      await page.keyboard.press('ControlOrMeta+A')
      await page.keyboard.insertText('export const value = 2\n')
      await page.getByTestId('workspace-collapse-files').click()
      await expect(page.getByTestId('workspace-files-panel')).toHaveCount(0)
      await page.getByTestId('workspace-toggle-files').click()
      await expect(editor).toContainText('export const value = 2')
      const save = page.getByTestId('file-save')
      await expect(save).toBeEnabled()
      await save.click()
      await expect.poll(() => fs.readFileSync(filePath, 'utf8')).toBe('export const value = 2\n')
      await expect(save).toBeDisabled()

      await editor.click()
      await page.keyboard.press('ControlOrMeta+A')
      await page.keyboard.insertText('export const value = 3\n')
      const savedPreview = await page.evaluate((path) => window.piSwitch.files.read(path), filePath)
      expect(savedPreview).toMatchObject({ kind: 'text', text: 'export const value = 2\n' })
      fs.writeFileSync(filePath, 'external change\n')
      expect(fs.readFileSync(filePath, 'utf8')).toBe('external change\n')
      const externalPreview = await page.evaluate(
        (path) => window.piSwitch.files.read(path),
        filePath
      )
      expect(externalPreview).toMatchObject({ kind: 'text', text: 'external change\n' })
      expect(externalPreview.revision).not.toBe(savedPreview.revision)
      const conflict = await page.evaluate(
        async ({ path, revision }) => {
          try {
            const result = await window.piSwitch.files.write(path, 'probe', revision)
            return { ok: true as const, result }
          } catch (error) {
            const ipcError = error as { code?: string; message?: string }
            return {
              ok: false as const,
              code: ipcError.code ?? null,
              message: ipcError.message ?? null
            }
          }
        },
        { path: filePath, revision: savedPreview.revision! }
      )
      expect(conflict).toMatchObject({ ok: false, code: 'FILE_CONFLICT' })
      await save.click()

      const dialog = page.getByRole('dialog')
      await expect(dialog).toContainText(/文件已被外部修改|File changed externally/)
      await dialog.getByRole('button', { name: /取消|Cancel/ }).click()
      expect(fs.readFileSync(filePath, 'utf8')).toBe('external change\n')

      await save.click()
      await dialog.getByRole('button', { name: /覆盖文件|Overwrite file/ }).click()
      await expect.poll(() => fs.readFileSync(filePath, 'utf8')).toBe('export const value = 3\n')
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  test('uploads files and refreshes an open preview after workspace changes', async ({
    page,
    workspaceRoot,
    piAgentDir
  }) => {
    const tempRoot = path.join(workspaceRoot, 'upload')
    fs.mkdirSync(tempRoot)
    const fixtureRoot = path.join(tempRoot, 'project')
    const sessionId = '01a026a4-0796-73ff-990a-a2be21983541'
    const uploadSource = path.join(tempRoot, 'uploaded.txt')
    fs.mkdirSync(fixtureRoot)
    fs.writeFileSync(path.join(fixtureRoot, 'existing.txt'), 'existing file')
    fs.writeFileSync(uploadSource, 'uploaded version 1')
    seedSession(piAgentDir, fixtureRoot, sessionId)

    try {
      await page.evaluate(
        async ({ root, selectedSessionId }) => {
          await window.piSwitch.workspace.allowRoot(root)
          localStorage.setItem(
            'pi-harness.workspace.v1',
            JSON.stringify({
              projectKey: null,
              pickedCwd: null,
              projectRoots: [],
              tabs: [
                {
                  id: `chat:${selectedSessionId}`,
                  kind: 'chat',
                  title: 'Upload fixture session',
                  sessionId: selectedSessionId,
                  closable: false
                }
              ],
              activeTabId: `chat:${selectedSessionId}`
            })
          )
        },
        { root: fixtureRoot, selectedSessionId: sessionId }
      )

      await page.locator('a[href="#/workspace"]').click()
      await page.getByTestId('workspace-toggle-files').click()
      await expect(page.getByRole('button', { name: 'existing.txt', exact: true })).toBeVisible()
      const chooser = page.waitForEvent('filechooser')
      await page.getByRole('button', { name: /上传文件|Upload files/ }).click()
      await (await chooser).setFiles(uploadSource)

      await expect(page.getByText(/已上传 1 个文件|1 file uploaded/)).toBeVisible({
        timeout: 5_000
      })
      await expect(page.getByRole('button', { name: 'uploaded.txt', exact: true })).toBeVisible()
      expect(fs.readFileSync(path.join(fixtureRoot, 'uploaded.txt'), 'utf8')).toBe(
        'uploaded version 1'
      )

      await page.getByRole('button', { name: 'uploaded.txt', exact: true }).click()
      const code = page.getByTestId('file-code-view').locator('.cm-content')
      await expect(code).toContainText('uploaded version 1')

      fs.writeFileSync(path.join(fixtureRoot, 'uploaded.txt'), 'uploaded version 2')
      await page.evaluate(() => window.dispatchEvent(new Event('focus')))
      await expect(code).toContainText('uploaded version 2')
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  test('shows local skills and the curated extension market', async ({ page }) => {
    await expect(page.getByText('Pi-Harness').first()).toBeVisible({ timeout: 30_000 })

    await page.locator('a[href="#/skills"]').click()
    await expect(page.locator('h1').filter({ hasText: /技能|Skills/ })).toBeVisible()
    await expect(page.locator('ul').getByText('demo-skill', { exact: true })).toBeVisible()

    await page.getByRole('tab', { name: /市场|Market/ }).click()
    await expect(page.getByText(/日常开发套件|Core Development/).first()).toBeVisible()
    await expect(page.getByText(/Agent 架构套件|Agent Architecture/).first()).toBeVisible()
    const curatedCollection = page
      .getByRole('listitem')
      .filter({ hasText: /精选扩展|Curated Extensions/ })
    await expect(curatedCollection).toBeVisible()
    await curatedCollection.click()
    await expect(page.getByText('pi-agent-mode', { exact: true })).toBeVisible()
    await expect(
      page.getByText('在同一进程内切换由 Markdown 定义的 Agent 模式。', { exact: true })
    ).toBeVisible()
    await expect(page.getByText('pi-lmstudio', { exact: true })).toBeVisible()
    await expect(page.getByText('@langchain/langsmith-pi-extension', { exact: true })).toBeVisible()
    await expect(page.getByText(/Pi Coding Agent.*一键安装/)).toHaveCount(0)
    await expect(page.getByText(/方案内容|Recipe content/)).toHaveCount(0)
  })

  test('installs, uninstalls, and reinstalls a bundled Matt Pocock Skill', async ({ page }) => {
    await page.locator('a[href="#/skills"]').click()
    await page.getByRole('tab', { name: /市场|Market/ }).click()

    const collection = page.getByTestId('market-collection-builtin:mattpocock-skills')
    await expect(collection).toContainText('Skills For Real Engineers')
    await collection.click()

    const skill = page.getByTestId('builtin-skill-tdd')
    await expect(skill).toContainText('tdd')
    await skill.getByRole('button', { name: /安装|Install/, exact: true }).click()
    await expect(skill).toContainText(/已安装|Installed/)

    await skill.getByRole('button', { name: /卸载技能|Uninstall skill/ }).click()
    const uninstall = page.getByRole('dialog', {
      name: /卸载 1 个内置技能|Uninstall 1 built-in Skills/
    })
    await uninstall.getByRole('button', { name: /卸载技能|Uninstall skill/ }).click()
    await expect(skill).toContainText(/未安装|Not installed/)

    await skill.getByRole('button', { name: /安装|Install/, exact: true }).click()
    await expect(skill).toContainText(/已安装|Installed/)

    const state = await page.evaluate(async () => {
      const market = await window.piSwitch.skills.market()
      const bundled = market.find(
        (entry) => entry.id === 'builtin:mattpocock-skills' && entry.kind === 'builtin-skills'
      )
      const tdd =
        bundled?.kind === 'builtin-skills'
          ? bundled.skills.find((entry) => entry.id === 'tdd')
          : undefined
      return {
        resources: tdd?.resources,
        installation: tdd?.installations.find((entry) => entry.scope === 'global')
      }
    })
    expect(state.resources).toEqual(expect.arrayContaining(['SKILL.md', 'tests.md', 'mocking.md']))
    expect(state.installation).toMatchObject({ installed: true, owned: true, health: 'healthy' })
  })

  test('uninstalls a user-authored standalone skill with a backup-first flow', async ({ page }) => {
    await page.locator('a[href="#/skills"]').click()
    await page.locator('ul').getByText('demo-skill', { exact: true }).click()
    await page.getByLabel(/卸载技能|Uninstall skill/).click()

    const dialog = page.getByRole('dialog', { name: /卸载技能|Uninstall skill/ })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: /卸载技能|Uninstall skill/ }).click()

    await expect(page.locator('ul').getByText('demo-skill', { exact: true })).toHaveCount(0)
  })

  test('reconciles and thoroughly unloads a registered package with missing files', async ({
    page
  }) => {
    await page.evaluate(async () => {
      const raw = await window.piSwitch.config.readRaw('settings')
      const settings = JSON.parse(raw.content || '{}') as { packages?: unknown[] }
      settings.packages = [...(settings.packages ?? []), 'npm:pi-e2e-missing']
      await window.piSwitch.config.writeRaw('settings', `${JSON.stringify(settings, null, 2)}\n`, {
        overwrite: true
      })
    })

    await page.locator('a[href="#/skills"]').click()
    await page.getByRole('tab', { name: /扩展包|Packages/, exact: true }).click()
    const packageRow = page.getByRole('listitem').filter({ hasText: 'pi-e2e-missing' })
    await expect(packageRow).toBeVisible()
    await packageRow.click()
    await expect(page.getByText(/已注册但文件缺失|Missing/, { exact: true }).first()).toBeVisible()
    await page.getByRole('button', { name: /卸载|Uninstall/, exact: true }).click()

    const dialog = page.getByRole('dialog', { name: /卸载扩展包|Uninstall package/ })
    await dialog.getByRole('button', { name: /卸载|Uninstall/, exact: true }).click()
    await expect(packageRow).toHaveCount(0)
  })

  test('saves color themes and keeps primary button text white', async ({ electronApp, page }) => {
    await expect(page.getByText('Pi-Harness').first()).toBeVisible({ timeout: 30_000 })

    await page.locator('a[href="#/settings"]').click()
    await expect(page.locator('h1').filter({ hasText: /设置|Settings/ })).toBeVisible()
    await page.getByTestId('settings-section-general').click()
    await expect(page.getByTestId('window-motion-toggle')).toHaveAttribute('aria-checked', 'false')
    await expect(page.getByTestId('screen-motion-toggle')).toHaveAttribute('aria-checked', 'true')
    await page.getByRole('button', { name: /主题|Theme/, exact: true }).click()
    await expect(page.getByRole('option', { name: /跟随系统|System/, exact: true })).toHaveCount(0)
    await page.getByRole('option', { name: /粉色|Pink/, exact: true }).click()
    const saveButton = page.getByRole('button', { name: /保存|Save/ })
    await expect
      .poll(() => saveButton.evaluate((element) => getComputedStyle(element).color))
      .toBe('rgb(255, 255, 255)')
    await saveButton.click()

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'pink')
    await expect(page.locator('html')).toHaveAttribute('data-appearance', 'light')
    await expect
      .poll(() => electronApp.evaluate(({ nativeTheme }) => nativeTheme.themeSource))
      .toBe('light')
    if (process.env.PI_HARNESS_DESIGN_QA_DIR) {
      await page.setViewportSize({ width: 1200, height: 780 })
      await page.screenshot({
        path: path.join(process.env.PI_HARNESS_DESIGN_QA_DIR, 'settings-pink-theme.png')
      })
    }
  })

  test('reorders the sidebar from settings', async ({ page }) => {
    await expect(page.getByText('Pi-Harness').first()).toBeVisible({ timeout: 30_000 })
    await page.locator('a[href="#/settings"]').click()
    await expect(page.locator('h1').filter({ hasText: /设置|Settings/ })).toBeVisible()
    await page.getByTestId('settings-section-nav').click()

    const items = page.getByTestId('nav-order-item')
    await expect(items.first()).toHaveAttribute('data-nav-id', 'workspace')
    await items.first().focus()
    await items.first().press('ArrowDown')
    await expect(items.first()).toHaveAttribute('data-nav-id', 'overview')
    await page.getByRole('button', { name: /保存|Save/ }).click()
    await expect(page.getByText(/设置已保存|Settings saved/)).toBeVisible()

    const rail = page.locator('[data-testid="app-navigation-rail"] a')
    await expect(rail.first()).toHaveAttribute('href', '#/')
    await expect(rail.nth(1)).toHaveAttribute('href', '#/workspace')
  })

  test('cleans backups according to the retention count after confirmation', async ({ page }) => {
    await expect(page.getByText('Pi-Harness').first()).toBeVisible({ timeout: 30_000 })
    await page.locator('a[href="#/settings"]').click()
    await expect(page.locator('h1').filter({ hasText: /设置|Settings/ })).toBeVisible()
    await page.getByTestId('settings-section-backup').click()

    const createBackup = page.getByRole('button', { name: /创建备份|Create backup/ })
    const backupRows = page.locator('main ul > li')
    await createBackup.click()
    await expect(backupRows).toHaveCount(1)
    await createBackup.click()
    await expect(backupRows).toHaveCount(2)

    await page.getByRole('spinbutton', { name: /保留数量|Retention count/ }).fill('1')
    await page.getByRole('button', { name: /清理|Clean up/, exact: true }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(
      /保留最新 1 个备份，并永久删除其余 1 个|Keep newest: 1.*delete older backups: 1/i
    )
    await dialog.getByRole('button', { name: /清理|Clean up/, exact: true }).click()
    await expect(backupRows).toHaveCount(1)
  })
})

function seedSession(agentDir: string, cwd: string, sessionId: string, label = 'Fixture session') {
  const safePath = `--${path
    .resolve(cwd)
    .replace(/^[/\\]/, '')
    .replace(/[/\\:]/g, '-')}--`
  const sessionDir = path.join(agentDir, 'sessions', safePath)
  const timestamp = '2026-08-29T05:00:00.000Z'
  fs.mkdirSync(sessionDir, { recursive: true })
  fs.writeFileSync(
    path.join(sessionDir, `2026-08-29T05-00-00-000Z_${sessionId}.jsonl`),
    [
      JSON.stringify({ type: 'session', version: 3, id: sessionId, timestamp, cwd }),
      JSON.stringify({
        type: 'message',
        id: '01a026a4-0796-73ff-990a-a2be2198353d',
        parentId: null,
        timestamp,
        message: { role: 'user', content: label, timestamp: Date.parse(timestamp) }
      })
    ].join('\n') + '\n'
  )
}

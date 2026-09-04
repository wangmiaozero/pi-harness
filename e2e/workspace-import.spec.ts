import fs from 'node:fs'
import path from 'node:path'
import { test, expect } from './fixtures'

for (const kind of ['folders', 'code-workspace', 'mixed'] as const) {
  test(`imports ${kind} as one project with all source folders`, async ({
    page,
    electronApp,
    workspaceRoot
  }) => {
    const roots = ['server', 'blog', 'docs'].map((name) => path.join(workspaceRoot, name))
    for (const root of roots) fs.mkdirSync(root)
    const workspaceFile = path.join(workspaceRoot, 'Combined.code-workspace')
    fs.writeFileSync(
      workspaceFile,
      JSON.stringify({ folders: [{ path: './server' }, { path: './blog' }, { path: './blog' }] })
    )
    const sources =
      kind === 'folders'
        ? [roots[0], roots[1], roots[1]]
        : kind === 'code-workspace'
          ? [workspaceFile]
          : [workspaceFile, roots[2]]
    const names = kind === 'mixed' ? ['server', 'blog', 'docs'] : ['server', 'blog']
    const projectName = kind === 'folders' ? 'server' : 'Combined'
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setViewportSize({ width: 1200, height: 780 })
    await page.evaluate(() => window.piSwitch.settings.set({ theme: 'light' }))
    await page.locator('a[href="#/workspace"]').click()
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'light'
    })
    const tree = page.getByTestId('workspace-session-tree')
    const groups = tree.getByTestId(/^workspace-project-group-/)
    await expect(groups).toHaveCount(0)

    await electronApp.evaluate(({ dialog }) => {
      dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] })
    })
    await page.getByTestId('workspace-import-workspace').click()
    await expect(groups).toHaveCount(0)

    await electronApp.evaluate(({ dialog }, selected) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: selected })
    }, sources)
    await page.getByTestId('workspace-import-workspace').click()
    await expect(groups).toHaveCount(1)
    await expect(page.getByTestId('workspace-project-0')).toContainText(projectName)
    await expect(tree.getByTestId(/^session-row-/)).toHaveCount(0)
    await expect(tree.getByText('blog', { exact: true })).toHaveCount(0)
    await expect
      .poll(() =>
        page.evaluate(async () =>
          (await window.piSwitch.workspace.getActive()).folders.map((folder) => folder.name)
        )
      )
      .toEqual(names)

    // Reimporting does not duplicate either the navigation entry or its source folders.
    await page.getByTestId('workspace-import-workspace').click()
    await expect(groups).toHaveCount(1)
    if (process.env.PI_HARNESS_DESIGN_QA_DIR) {
      await page.screenshot({
        animations: 'disabled',
        path: path.join(process.env.PI_HARNESS_DESIGN_QA_DIR, `import-${kind}-project.png`)
      })
    }

    await page.reload()
    await expect(groups).toHaveCount(1)
    await expect(page.getByTestId('workspace-project-0')).toContainText(projectName)
    await expect(page.getByTestId('workspace-new-session')).toBeDisabled()
    await page.getByTestId('workspace-toggle-files').click()
    await expect(page.getByTestId('workspace-files-unavailable')).toBeVisible()
    // The imported project appears in the workspace-wide Git view.
    await page.locator('a[href="#/git"]').click()
    await expect(page.getByTestId('git-repository-sidebar')).toContainText(projectName)
    await page.locator('a[href="#/workspace"]').click()

    await electronApp.evaluate(({ Menu }) => {
      Menu.buildFromTemplate = ((items: Electron.MenuItemConstructorOptions[]) =>
        ({
          popup(options: { callback?: () => void }) {
            items
              .find((item) => item.id === 'edit')
              ?.click?.({} as Electron.MenuItem, undefined, {} as Electron.KeyboardEvent)
            options.callback?.()
          }
        }) as Electron.Menu) as typeof Menu.buildFromTemplate
    })
    await page.getByTestId('workspace-project-0').click({ button: 'right' })
    const editor = page.getByRole('dialog', { name: /编辑项目|Edit project/ })
    await expect(editor).toBeVisible()
    await expect(editor.getByRole('textbox')).toHaveValue(projectName)
    await expect(editor.getByTestId(/^session-workspace-folder-/)).toHaveCount(names.length)
    for (const [index, name] of names.entries()) {
      await expect(editor.getByTestId(`session-workspace-folder-${index}`)).toContainText(name)
    }
    const primary = editor.getByTestId('session-workspace-folder-0')
    await expect(primary).toContainText(/主目录|Primary/)
    await expect(primary.getByRole('button')).toBeDisabled()
    if (process.env.PI_HARNESS_DESIGN_QA_DIR) {
      await page.screenshot({
        animations: 'disabled',
        path: path.join(process.env.PI_HARNESS_DESIGN_QA_DIR, `import-${kind}-sources.png`)
      })
    }
    await editor.getByRole('button', { name: /取消|Cancel/, exact: true }).click()

    await page.getByTestId('workspace-new-project-session-0').click()
    await expect
      .poll(() =>
        page.evaluate(async () =>
          (await window.piSwitch.workspace.getActive()).folders.map((folder) => ({
            name: folder.name,
            role: folder.role
          }))
        )
      )
      .toEqual(names.map((name, index) => ({ name, role: index === 0 ? 'main' : 'reference' })))
    await expect(groups).toHaveCount(1)
    await expect(page.locator('main textarea')).toBeVisible()
    if (!(await page.getByTestId('workspace-files-panel').isVisible())) {
      await page.getByTestId('workspace-toggle-files').click()
    }
    await expect(page.getByTestId('workspace-files-unavailable')).toBeVisible()
    await page.locator('a[href="#/git"]').click()
    await expect(page.getByTestId('git-repository-sidebar')).toContainText(projectName)
    await page.locator('a[href="#/workspace"]').click()
    expect(errors).toEqual([])
  })
}

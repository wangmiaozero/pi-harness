import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { test, expect } from './fixtures'

test.describe('Pi-Harness smoke', () => {
  test('launches and shows overview', async ({ page }) => {
    await expect(page.getByText('Pi-Harness').first()).toBeVisible({ timeout: 30_000 })
    // zh-CN default label for Overview is 「概览」
    await expect(page.locator('a[href="#/"]').filter({ hasText: /概览|Overview/ })).toBeVisible()
  })

  test('navigates Workspace / Providers / Models / Settings / Config', async ({ page }) => {
    const pageErrors: string[] = []
    const consoleErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    await expect(page.getByText('Pi-Harness').first()).toBeVisible({ timeout: 30_000 })

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
    await expect(page.locator('main aside')).toBeVisible()
    await expect(page.getByTestId('workspace-project-required')).toBeVisible()
    await expect(page.getByTestId('workspace-new-session')).toBeDisabled()
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

    await page.locator('a[href="#/providers"]').click()
    await expect(page.locator('h1').filter({ hasText: /提供商|Providers/ })).toBeVisible()

    await page.locator('a[href="#/models"]').click()
    await expect(page.locator('h1').filter({ hasText: /模型|Models/ })).toBeVisible()

    await page.locator('a[href="#/settings"]').click()
    await expect(page.locator('h1').filter({ hasText: /设置|Settings/ })).toBeVisible()

    await page.locator('a[href="#/config"]').click()
    await expect(page.getByText(/models\.json/i).first()).toBeVisible()

    expect(pageErrors).toEqual([])
    expect(consoleErrors).toEqual([])
  })

  test('opens a source file in the Workspace code viewer', async ({ page }) => {
    const pageErrors: string[] = []
    const consoleErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })

    const fixtureRoot = path.resolve(import.meta.dirname, '../fixtures')
    await page.evaluate(async (root) => {
      await window.piSwitch.workspace.allowRoot(root)
      localStorage.setItem(
        'pi-harness.workspace.v1',
        JSON.stringify({ projectKey: null, pickedCwd: root, tabs: [], activeTabId: null })
      )
    }, fixtureRoot)

    await page.locator('a[href="#/workspace"]').click()
    const projectTree = page.getByTestId('workspace-project-tree')
    await expect(projectTree.getByText('fixtures', { exact: true })).toBeVisible()
    await expect(
      projectTree.locator('[data-project-key]').filter({ hasText: 'fixtures' })
    ).toHaveCount(1)
    const composer = page.locator('main textarea')
    await expect(composer).toBeVisible()
    await composer.focus()
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

    await page.getByRole('button', { name: /文件|Files/, exact: true }).click()
    await expect(aiMotion).toHaveClass(/opacity-0/)
    await page.getByRole('button', { name: 'code-preview.html', exact: true }).click()

    const code = page.getByTestId('file-code-view')
    await expect(code).toBeVisible()
    await expect(code.locator('.cm-content')).toContainText('const answer = 42')
    await expect(code.locator('.cm-gutterElement')).not.toHaveCount(0)
    await expect(page.getByText(/15 行|15 lines/)).toBeVisible()

    await page.locator('main aside').getByRole('button', { name: 'README.md', exact: true }).click()
    const tabs = page.getByTestId('workspace-tabs')
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
    expect(pageErrors).toEqual([])
    expect(consoleErrors).toEqual([])
  })

  test('edits, saves, and protects externally changed text files', async ({ page }) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-harness-editor-e2e-'))
    const filePath = path.join(tempRoot, 'editable.ts')
    fs.mkdirSync(path.join(tempRoot, 'node_modules'))
    fs.writeFileSync(path.join(tempRoot, '.env'), 'TOKEN=test\n')
    fs.writeFileSync(filePath, 'export const value = 1\n')

    try {
      await page.evaluate(async (root) => {
        await window.piSwitch.workspace.allowRoot(root)
        localStorage.setItem(
          'pi-harness.workspace.v1',
          JSON.stringify({ projectKey: null, pickedCwd: root, tabs: [], activeTabId: null })
        )
      }, tempRoot)

      await page.locator('a[href="#/workspace"]').click()
      await page.getByRole('button', { name: /文件|Files/, exact: true }).click()
      await expect(page.getByRole('button', { name: 'node_modules', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: '.env', exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'editable.ts', exact: true }).click()

      const editor = page.getByTestId('file-code-view').locator('.cm-content')
      await expect(editor).toHaveAttribute('contenteditable', 'true')
      await editor.click()
      await page.keyboard.press('ControlOrMeta+A')
      await page.keyboard.insertText('export const value = 2\n')
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

  test('uploads files and refreshes an open preview after workspace changes', async ({ page }) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-harness-upload-e2e-'))
    const fixtureRoot = path.join(tempRoot, 'project')
    const uploadSource = path.join(tempRoot, 'uploaded.txt')
    fs.mkdirSync(fixtureRoot)
    fs.writeFileSync(path.join(fixtureRoot, 'existing.txt'), 'existing file')
    fs.writeFileSync(uploadSource, 'uploaded version 1')

    try {
      await page.evaluate(async (root) => {
        await window.piSwitch.workspace.allowRoot(root)
        localStorage.setItem(
          'pi-harness.workspace.v1',
          JSON.stringify({ projectKey: null, pickedCwd: root, tabs: [], activeTabId: null })
        )
      }, fixtureRoot)

      await page.locator('a[href="#/workspace"]').click()
      await page.getByRole('button', { name: /文件|Files/, exact: true }).click()
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

  test('opens the create provider dialog', async ({ page }) => {
    const pageErrors: string[] = []
    const consoleErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message))
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') {
        consoleErrors.push(message.text())
      }
    })
    await expect(page.getByText('Pi-Harness').first()).toBeVisible({ timeout: 30_000 })

    await page.locator('a[href="#/providers"]').click()
    await page.getByRole('button', { name: /新建提供商|New provider/ }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(/新建提供商|New provider/)
    await expect(dialog.getByRole('button', { name: /保存|Save/ })).toBeVisible()

    const apiKeyType = dialog.getByRole('button', {
      name: /API 密钥类型|API key type/,
      exact: true
    })
    await apiKeyType.click()
    await page.getByRole('option', { name: /明文|Literal \(plaintext\)/, exact: true }).click()
    await expect(apiKeyType).toContainText(/明文|Literal \(plaintext\)/)

    expect(pageErrors).toEqual([])
    expect(consoleErrors).toEqual([])
  })

  test('shows local skills and the curated extension market', async ({ page }) => {
    await expect(page.getByText('Pi-Harness').first()).toBeVisible({ timeout: 30_000 })

    await page.locator('a[href="#/skills"]').click()
    await expect(page.locator('h1').filter({ hasText: /技能|Skills/ })).toBeVisible()
    await expect(page.locator('ul').getByText('demo-skill', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: /市场|Market/ }).click()
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

  test('saves the light theme without requiring Pi', async ({ page }) => {
    await expect(page.getByText('Pi-Harness').first()).toBeVisible({ timeout: 30_000 })

    await page.locator('a[href="#/settings"]').click()
    await expect(page.locator('h1').filter({ hasText: /设置|Settings/ })).toBeVisible()
    await page.getByRole('button', { name: /主题|Theme/, exact: true }).click()
    await page.getByRole('option', { name: /浅色|Light/, exact: true }).click()
    await page.getByRole('button', { name: /保存|Save/ }).click()

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  })

  test('cleans backups according to the retention count after confirmation', async ({ page }) => {
    await expect(page.getByText('Pi-Harness').first()).toBeVisible({ timeout: 30_000 })
    await page.locator('a[href="#/settings"]').click()
    await expect(page.locator('h1').filter({ hasText: /设置|Settings/ })).toBeVisible()

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

  test('opens the install confirmation when Pi is missing', async ({ page }) => {
    const pageErrors: string[] = []
    const consoleErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    await expect(page.getByText('Pi-Harness').first()).toBeVisible({ timeout: 30_000 })

    await page.getByRole('button', { name: /安装 Pi|Install Pi/ }).click()

    await page.waitForTimeout(250)
    expect(pageErrors).toEqual([])
    expect(consoleErrors).toEqual([])

    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('dialog')).toContainText(/安装 Pi|Install Pi/)
  })
})

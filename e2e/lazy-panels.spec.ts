import fs from 'node:fs'
import path from 'node:path'
import { test, expect } from './fixtures'
import { IPC_INVOKE } from '../src/shared/ipc/channels'

test('loads optional editors on use and keeps skill editing, saving and reopening working', async ({
  page
}) => {
  const debuggerSession = await page.context().newCDPSession(page)
  const scripts = new Set<string>()
  debuggerSession.on('Debugger.scriptParsed', ({ url }) => scripts.add(url))
  await debuggerSession.send('Debugger.enable')
  const modules = () => [...scripts]
  await page.locator('a[href="#/workspace"]').click()
  await expect(page.getByTestId('workspace-main')).toBeVisible()
  expect(
    (await modules()).some((name) =>
      /(?:codemirror|FileViewer|HarnessConsole|OrchestrationConsole|ProjectIntelligencePanel)-.*\.js/.test(
        name
      )
    )
  ).toBe(false)
  await page.locator('a[href="#/skills"]').click()
  await page.getByRole('tab', { name: /技能|Skills/, exact: true }).click()
  const create = page.getByRole('button', { name: /新建技能|New skill|Create skill/ })
  await expect(create).toBeVisible()
  expect(
    (await modules()).some((name) => /(?:codemirror|SkillEditorDialog)-.*\.js/.test(name))
  ).toBe(false)
  await create.click()
  const dialog = page.getByRole('dialog')
  const editor = dialog.locator('.cm-content')
  await expect(editor).toBeVisible()
  await dialog.getByLabel(/名称|Name/, { exact: true }).fill('lazy-editor-fixture')
  await dialog.getByLabel(/描述|Description/, { exact: true }).fill('Local editor fixture')
  await editor.click()
  await page.keyboard.press('ControlOrMeta+A')
  const content = '# First saved content\n'
  await page.keyboard.insertText(content)
  await dialog.getByRole('button', { name: /保存|Save/, exact: true }).click()
  await expect(dialog).toBeHidden()
  const skill = await page.evaluate(async () =>
    (await window.piSwitch.skills.list()).find((item) => item.name === 'lazy-editor-fixture')
  )
  expect(skill).toBeDefined()
  const skillFile = path.join(skill!.path, 'SKILL.md')
  expect(fs.readFileSync(skillFile, 'utf8')).toContain(content)
  await page.getByText('lazy-editor-fixture', { exact: true }).click()
  await page.getByRole('button', { name: /编辑|Edit/, exact: true }).click()
  await expect(editor).toContainText('First saved content')
  await editor.click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.insertText(content.replace('First saved', 'Second saved'))
  await dialog.getByRole('button', { name: /保存|Save/, exact: true }).click()
  await expect(dialog).toBeHidden()
  expect(fs.readFileSync(skillFile, 'utf8')).toContain('Second saved content')
  await create.click()
  await expect(editor).toBeVisible()
  await dialog.getByRole('button', { name: /取消|Cancel/, exact: true }).click()
  await create.click()
  await expect(editor).toBeVisible()
  await expect(dialog.getByLabel(/名称|Name/, { exact: true })).toHaveValue('')
  expect((await modules()).some((name) => /codemirror-.*\.js/.test(name))).toBe(true)
})

test('refreshes providers once per menu entry while retaining the provider-first gate', async ({
  page,
  electronApp
}) => {
  await electronApp.evaluate(({ ipcMain }, channel) => {
    const handlers = (
      ipcMain as unknown as { _invokeHandlers: Map<string, (...args: unknown[]) => unknown> }
    )._invokeHandlers
    const original = handlers.get(channel)!
    const state = globalThis as typeof globalThis & { __providerReads: number }
    state.__providerReads = 0
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, (...args) => {
      state.__providerReads++
      return original(...args)
    })
  }, IPC_INVOKE.providerList)
  const reads = () =>
    electronApp.evaluate(
      () => (globalThis as typeof globalThis & { __providerReads: number }).__providerReads
    )
  await page.locator('a[href="#/models"]').click()
  await expect(page.getByTestId('model-management-tab-models')).toBeEnabled()
  await expect(page.getByTestId('model-action-cell')).toHaveCount(2)
  expect(await reads()).toBe(1)
  await page.getByTestId('model-management-tab-providers').click()
  await expect(page.getByTestId('provider-action-cell')).toHaveCount(2)
  expect(await reads()).toBe(1)
  await page.locator('a[href="#/workspace"]').click()
  // Lazy navigation can still be pending when click resolves. Confirm that the
  // management view unmounted before returning to its cached model rows.
  await expect(page.getByTestId('workspace-main')).toBeVisible()
  await expect(page.getByTestId('model-management-view')).toHaveCount(0)
  await page.locator('a[href="#/models"]').click()
  // Cached rows alone do not establish that the provider refresh has finished.
  await expect(page.getByTestId('model-management-tab-models')).toBeEnabled()
  await expect(page.getByTestId('model-action-cell')).toHaveCount(2)
  expect(await reads()).toBe(2)
})

test('restores managed workspace history without live-runtime IPC errors', async ({
  page,
  electronApp,
  piAgentDir
}) => {
  const root = await page.evaluate(() => window.piSwitch.workspace.getDefaultRoot())
  const id = '01a426a4-0796-73ff-990a-a2be2198354e'
  const sessionDir = path.join(
    piAgentDir,
    'sessions',
    `--${root!.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`
  )
  fs.mkdirSync(sessionDir, { recursive: true })
  const timestamp = '2026-10-13T05:00:00.000Z'
  fs.writeFileSync(
    path.join(sessionDir, `2026-10-13T05-00-00-000Z_${id}.jsonl`),
    [
      JSON.stringify({ type: 'session', version: 3, id, timestamp, cwd: root }),
      JSON.stringify({
        type: 'message',
        id: 'user',
        parentId: null,
        timestamp,
        message: {
          role: 'user',
          content: 'Inactive default chat',
          timestamp: Date.parse(timestamp)
        }
      })
    ].join('\n') + '\n'
  )
  await electronApp.evaluate(
    ({ ipcMain }, channels) => {
      const handlers = (
        ipcMain as unknown as { _invokeHandlers: Map<string, (...args: unknown[]) => unknown> }
      )._invokeHandlers
      const state = globalThis as typeof globalThis & {
        __historyReads: { live: number; errors: unknown[] }
      }
      state.__historyReads = { live: 0, errors: [] }
      for (const channel of channels) {
        const original = handlers.get(channel)!
        ipcMain.removeHandler(channel)
        ipcMain.handle(channel, async (...args) => {
          if (channel === channels[0]) state.__historyReads.live++
          const result = await original(...args)
          if (result && typeof result === 'object' && 'error' in result)
            state.__historyReads.errors.push(result)
          return result
        })
      }
    },
    [IPC_INVOKE.harnessGetSession, IPC_INVOKE.workspaceAllowRoot]
  )
  // Model a persisted session whose runtime is unavailable. Composer metadata
  // reads may fail, but history/permissions and Harness's null-state path are real.
  await electronApp.evaluate(({ ipcMain }, channel) => {
    const handlers = (
      ipcMain as unknown as { _invokeHandlers: Map<string, (...args: unknown[]) => unknown> }
    )._invokeHandlers
    const original = handlers.get(channel)!
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, (...args) => {
      const input = args[1] as { type?: string }
      if (input.type === 'get_tools' || input.type === 'get_session_stats') {
        return {
          ok: false,
          error: {
            code: 'SESSION_NOT_RUNNING',
            message: 'Fixture runtime unavailable',
            recoverable: true
          }
        }
      }
      return original(...args)
    })
  }, IPC_INVOKE.agentCommand)
  await page.locator('a[href="#/workspace"]').click()
  await page.getByTestId('workspace-refresh').click()
  await page
    .getByTestId(`session-row-${id}`)
    .getByRole('button', { name: 'Inactive default chat', exact: true })
    .click()
  await expect(page.getByTestId('chat-scroller')).toContainText('Inactive default chat')
  await page.getByTestId('workspace-section-tools').click()
  await expect(page.getByTestId('harness-console')).toBeVisible()
  await expect(page.getByTestId('harness-console').getByRole('alert')).toHaveCount(0)
  const reads = await electronApp.evaluate(
    () =>
      (globalThis as typeof globalThis & { __historyReads: { live: number; errors: unknown[] } })
        .__historyReads
  )
  expect(reads).toEqual({ live: 0, errors: [] })
  expect(await page.evaluate(() => window.piSwitch.agent.running())).toEqual([])
})

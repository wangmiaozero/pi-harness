import { test, expect } from './fixtures'
import { seedWorkspaceSession } from './workspace-fixtures'
import { IPC_EVENT, IPC_INVOKE } from '../src/shared/ipc/channels'

test('retains the working transcript across routes and tools while hidden streams stay in the store', async ({
  page,
  electronApp,
  workspaceRoot,
  piAgentDir
}) => {
  const id = '01a126a4-0796-73ff-990a-a2be2198354e'
  seedWorkspaceSession(piAgentDir, workspaceRoot, id, 'View lifecycle fixture')
  await page.locator('a[href="#/workspace"]').click()
  await page.getByTestId('workspace-refresh').click()
  await page
    .getByTestId(`session-row-${id}`)
    .getByRole('button', { name: 'View lifecycle fixture', exact: true })
    .click()
  await expect(page.getByTestId('chat-scroller')).toContainText('View lifecycle fixture')
  await page.getByTestId('composer-editor').fill('Unsaved composer draft')
  await page.getByTestId('chat-window').evaluate((element) => {
    ;(window as any).__chatIdentity = element
  })
  const emit = (events: unknown[]) =>
    electronApp.evaluate(
      ({ BrowserWindow }, { id, channel, events }) => {
        const contents = BrowserWindow.getAllWindows().find(
          (w) => !w.webContents.getURL().includes('overlay.html')
        )!.webContents
        contents.send(
          channel,
          events.map((event) => ({ sessionId: id, event }))
        )
      },
      { id, channel: IPC_EVENT.agentEvent, events }
    )
  await emit([
    { type: 'agent_start' },
    {
      type: 'message_start',
      message: { role: 'assistant', model: 'fixture', provider: 'fixture', content: [] }
    },
    { type: 'message_update', assistantMessageEvent: { type: 'text_start', contentIndex: 0 } },
    {
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Visible prefix' }
    }
  ])
  await expect(page.getByTestId('chat-scroller')).toContainText('Visible prefix')
  await page.locator('a[href="#/models"]').click()
  await expect(page.getByTestId('model-management-view')).toBeVisible()
  await expect(page.getByTestId('workspace-toggle-files')).toHaveCount(0)
  await emit([
    {
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: ' hidden route suffix' }
    }
  ])
  await page.locator('a[href="#/workspace"]').click()
  await expect(page.getByTestId('chat-scroller')).toContainText(
    'Visible prefix hidden route suffix'
  )
  expect(
    await page
      .getByTestId('chat-window')
      .evaluate((element) => element === (window as any).__chatIdentity)
  ).toBe(true)
  await expect(page.getByTestId('composer-editor')).toHaveText('Unsaved composer draft')
  await page.getByTestId('workspace-section-tools').click()
  await expect(page.getByTestId('harness-console')).toBeVisible()
  await emit([
    {
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: ' hidden tools suffix' }
    }
  ])
  await page.getByTestId('workspace-section-workspace').click()
  await expect(page.getByTestId('chat-scroller')).toContainText('hidden tools suffix')
  expect(
    await page
      .getByTestId('chat-window')
      .evaluate((element) => element === (window as any).__chatIdentity)
  ).toBe(true)
  // Each activation refreshes the list once; it must retain the loaded transcript.
  await electronApp.evaluate(
    ({ ipcMain }, channels) => {
      const handlers = (ipcMain as any)._invokeHandlers as Map<string, (...args: any[]) => any>
      ;(globalThis as any).__lifecycleReads = { lists: 0, details: 0 }
      channels.forEach((channel, index) => {
        const original = handlers.get(channel)!
        ipcMain.removeHandler(channel)
        ipcMain.handle(channel, (...args: any[]) => {
          ;(globalThis as any).__lifecycleReads[index === 0 ? 'lists' : 'details']++
          return original(...args)
        })
      })
    },
    [IPC_INVOKE.sessionList, IPC_INVOKE.sessionGet]
  )
  for (let i = 0; i < 3; i++) {
    await page.locator('a[href="#/models"]').click()
    await expect(page.getByTestId('model-management-view')).toBeVisible()
    await page.locator('a[href="#/workspace"]').click()
    await expect(page.getByTestId('composer-editor')).toHaveText('Unsaved composer draft')
  }
  await expect
    .poll(() => electronApp.evaluate(() => (globalThis as any).__lifecycleReads))
    .toEqual({ lists: 3, details: 0 })
  expect(
    await page
      .getByTestId('chat-window')
      .evaluate((element) => element === (window as any).__chatIdentity)
  ).toBe(true)
  await electronApp.evaluate(({ Menu }) => {
    Menu.buildFromTemplate = ((items: Electron.MenuItemConstructorOptions[]) => ({
      popup(options: { callback?: () => void }) {
        items
          .find((item) => item.id === 'rename')
          ?.click?.({} as Electron.MenuItem, undefined, {} as Electron.KeyboardEvent)
        options.callback?.()
      }
    })) as typeof Menu.buildFromTemplate
  })
  await page
    .getByTestId(`session-row-${id}`)
    .getByRole('button', { name: 'View lifecycle fixture', exact: true })
    .click({ button: 'right' })
  await expect(page.getByRole('dialog', { name: /重命名聊天|Rename chat/ })).toBeVisible()
  await page.keyboard.press('ControlOrMeta+,')
  await expect(page).toHaveURL(/#\/settings\//)
  await expect(page.getByRole('dialog', { name: /重命名聊天|Rename chat/ })).toHaveCount(0)
  await page.locator('a[href="#/workspace"]').click()
  await page
    .getByTestId('chat-status-hud')
    .getByRole('button', { name: /完整历史|Full history/ })
    .click()
  await expect(page.getByRole('dialog', { name: /完整历史|Full history/ })).toBeVisible()
  await page.keyboard.press('ControlOrMeta+,')
  await expect(page).toHaveURL(/#\/settings\//)
  await expect(page.getByRole('dialog', { name: /完整历史|Full history/ })).toHaveCount(0)
})

test('dismisses portaled composer UI when a shortcut changes the route', async ({ page }) => {
  await page.locator('a[href="#/workspace"]').click()
  const editor = page.getByTestId('composer-editor')
  await editor.click()
  await editor.pressSequentially('Use @demo')
  await expect(page.getByTestId('composer-skill-menu')).toBeVisible()
  await page.keyboard.press('ControlOrMeta+,')
  await expect(page).toHaveURL(/#\/settings\//)
  await expect(page.getByTestId('composer-skill-menu')).toHaveCount(0)
  await page.locator('a[href="#/workspace"]').click()
  await expect(editor).toHaveText('Use @demo')
  const model = page.getByTestId('workspace-model-select').getByRole('button')
  await model.evaluate((element) => ((window as any).__modelTrigger = element))
  await model.click()
  await expect(page.getByTestId('composer-vendor-panel')).toBeVisible()
  await page.keyboard.press('ControlOrMeta+,')
  await expect(page).toHaveURL(/#\/settings\//)
  await expect(page.getByTestId('composer-vendor-panel')).toHaveCount(0)
  await page.locator('a[href="#/workspace"]').click()
  expect(await model.evaluate((element) => element === (window as any).__modelTrigger)).toBe(true)
  await expect(model).toHaveAttribute('aria-expanded', 'false')
  await page.getByRole('button', { name: /更改工具预设|Change tool preset/, exact: true }).click()
  await expect(page.getByRole('listbox', { name: /更改工具预设|Change tool preset/ })).toBeVisible()
  await page.keyboard.press('ControlOrMeta+,')
  await expect(page).toHaveURL(/#\/settings\//)
  await expect(page.getByRole('listbox', { name: /更改工具预设|Change tool preset/ })).toHaveCount(
    0
  )
  await page.locator('a[href="#/workspace"]').click()
  await page.getByTestId('composer-more').click()
  await expect(page.getByTestId('composer-sound-toggle')).toBeVisible()
  await page.keyboard.press('ControlOrMeta+,')
  await expect(page).toHaveURL(/#\/settings\//)
  await expect(page.getByTestId('composer-sound-toggle')).toHaveCount(0)
})

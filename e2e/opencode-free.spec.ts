import { test, expect } from './fixtures'
import fs from 'node:fs/promises'
import path from 'node:path'
import { IPC_INVOKE } from '../src/shared/ipc/channels'

const previousE2E = process.env.PI_HARNESS_E2E
test.beforeAll(() => {
  process.env.PI_HARNESS_E2E = '1'
})
test.afterAll(() => {
  if (previousE2E === undefined) delete process.env.PI_HARNESS_E2E
  else process.env.PI_HARNESS_E2E = previousE2E
})

test('OpenCode has a shared Zen and Go key form and preserves the current provider', async ({
  page,
  piAgentDir,
  testUserData,
  electronApp
}) => {
  const before = await fs.readFile(path.join(piAgentDir, 'settings.json'), 'utf8')
  await page.locator('a[href="#/models"]').click()
  await page.getByTestId('model-management-tab-providers').click()
  const panel = page.getByTestId('opencode-free-panel')
  await expect(panel).toHaveCount(0)
  await page.getByTestId('model-management-tab-opencode').click()
  await expect(page.getByTestId('model-management-tab-opencode')).toHaveAttribute(
    'aria-selected',
    'true'
  )
  await expect(page).toHaveURL(/tab=opencode/)
  await expect(panel).toContainText('OpenCode')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(panel.getByRole('combobox')).toHaveCount(0)
  await expect(panel).toContainText('Zen / Go')
  await expect(
    panel
      .getByTestId('opencode-header-actions')
      .getByRole('switch', { name: '在工作区显示', exact: true })
  ).toBeVisible()
  await electronApp.evaluate(({ shell }) => {
    shell.openExternal = async (url) => {
      ;(globalThis as any).__openCodeKeyUrl = url
    }
  })
  await panel.getByRole('button', { name: '官方 API Key 页面', exact: true }).click()
  await expect
    .poll(() => electronApp.evaluate(() => (globalThis as any).__openCodeKeyUrl))
    .toBe('https://opencode.ai/console/account')

  await panel.getByTestId('opencode-more-actions').getByRole('button').click()
  await expect(page.getByRole('menuitem', { name: /刷新模型|Refresh models/ })).toBeVisible()
  await panel.getByTestId('opencode-more-actions').getByRole('button').click()
  await expect(panel.getByRole('switch', { name: /启用|Enabled/, exact: true })).toHaveCount(0)
  await panel.getByRole('button', { name: /添加 Key|Add key/, exact: true }).click()
  const dialog = page.getByRole('dialog')
  const save = dialog.getByRole('button', { name: /保存|Save/, exact: true })
  await expect(save).toBeDisabled()
  await dialog.getByRole('textbox', { name: /Key 名称|Key name/, exact: true }).fill('UI fixture')
  const key = dialog.getByLabel(/官方 API Key|Official API key/, { exact: true })
  await key.fill('ui-only-not-saved')
  await dialog.getByRole('button', { name: /^显示$|^Show$/ }).click()
  await expect(key).toHaveAttribute('type', 'text')
  await dialog.getByRole('button', { name: /^隐藏$|^Hide$/ }).click()
  await expect(key).toHaveAttribute('type', 'password')
  await dialog.getByRole('button', { name: /取消|Cancel/, exact: true }).click()
  await expect(dialog).toHaveCount(0)
  const persisted = JSON.parse(
    await fs.readFile(path.join(testUserData, 'opencode-free.json'), 'utf8')
  )
  expect(persisted).toMatchObject({ enabled: false, hasCredential: false, credentials: [] })
  expect(JSON.stringify(persisted)).not.toContain('ui-only-not-saved')
  expect(await fs.readFile(path.join(piAgentDir, 'settings.json'), 'utf8')).toBe(before)
  const rejected = await page.evaluate(async () => {
    const api = window.piSwitch
    const attempt = async (work: () => Promise<unknown>) => {
      try {
        await work()
        return false
      } catch {
        return true
      }
    }
    return Promise.all([
      attempt(() =>
        api.openCodeFree.configure({
          enabled: true,
          authMode: 'inference',
          consent: false
        } as never)
      ),
      attempt(() => api.openCodeFree.test('../invalid')),
      attempt(() => api.openCodeFree.test('big-pickle', { confirmInference: false } as never)),
      attempt(() =>
        api.openCodeFree.configure({ enabled: true, authMode: 'anonymous', consent: true } as never)
      ),
      attempt(() => api.openCodeFree.select('big-pickle')),
      attempt(() => api.providers.revealApiKey('opencode-free')),
      attempt(() => api.openCodeFree.revealCredential('../invalid')),
      attempt(() => api.openCodeFree.revealCredential('11111111-1111-1111-1111-111111111111')),
      attempt(() =>
        api.openCodeFree.setWorkspaceVisibility({ showInWorkspace: true, modelIds: [] })
      ),
      attempt(() =>
        api.openCodeFree.setWorkspaceVisibility({
          showInWorkspace: false,
          modelIds: ['../invalid']
        })
      )
    ])
  })
  expect(rejected).toEqual([true, true, true, true, true, true, true, true, true, true])
  await page.getByTestId('model-management-tab-providers').click()
  await expect(panel).toHaveCount(0)
  await page.getByTestId('model-management-tab-opencode').click()
  await panel.getByTestId('opencode-more-actions').getByRole('button').click()
  await expect(page.getByRole('menuitem', { name: /刷新模型|Refresh models/ })).toBeVisible()
  await panel.getByTestId('opencode-more-actions').getByRole('button').click()
  await page.screenshot({ path: '/tmp/pi-harness-opencode-panel.png' })
})

test('named keys and paid model verification work through the preload bridge (mock Main storage/network)', async ({
  page,
  electronApp
}) => {
  // Isolated fixture handlers: never read/write the developer's real Keychain or send inference.
  await electronApp.evaluate(({ ipcMain }, channels) => {
    const credential = { id: 'default', name: 'Personal' }
    const state = {
      schemaVersion: 2,
      workspaceModelIds: ['test', 'retired-model'],
      enabled: true,
      authMode: 'inference',
      hasCredential: true,
      credentials: [credential],
      activeCredentialId: 'default',
      connectionStatus: 'CONNECTED',
      httpStatus: 200,
      allowedPaidModels: ['paid-model'],
      authorizedModels: ['paid-model'],
      selectedModel: null,
      refreshedAt: Date.now(),
      error: null,
      models: [
        {
          id: 'paid-model',
          name: 'Paid fixture',
          price: 'paid',
          available: true,
          api: 'openai-completions',
          cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 200000,
          maxTokens: 32000,
          input: ['text'],
          reasoning: false,
          streaming: 'verified',
          tools: 'verified',
          checkedAt: null,
          status: 'ready',
          errorCode: null
        },
        { id: 'test', name: 'test', price: 'unknown', available: true }
      ]
    }
    state.models.push({ ...state.models[0], id: 'other-model', name: 'Other model' })
    const secrets = new Map([['default', 'fixture-personal-key']])
    const ok = (data: unknown) => ({ ok: true, data })
    const handlers: Record<string, (...args: any[]) => unknown> = {
      [channels.openCodeState]: () => ok(state),
      [channels.openCodeRefresh]: () => {
        state.error = null
        ;(globalThis as any).__openCodeRefreshCount =
          ((globalThis as any).__openCodeRefreshCount ?? 0) + 1
        return ok(state)
      },
      [channels.openCodeWorkspaceVisibility]: (_e, form) => {
        ;(globalThis as any).__openCodeVisibilityInput = form
        if ((globalThis as any).__rejectOpenCodeVisibility) {
          return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'MODEL_UNAVAILABLE' } }
        }
        Object.assign(state, {
          showInWorkspace: form.showInWorkspace,
          workspaceModelIds: form.modelIds
        })
        return ok(state)
      },
      [channels.openCodeRevealCredential]: (_e, id: string) => ok(secrets.get(id)),
      [channels.openCodeSaveCredential]: (_e, form) => {
        const id = form.id ?? '11111111-1111-1111-1111-111111111111'
        const existing = state.credentials.find((c) => c.id === id)
        if (existing) existing.name = form.name
        else state.credentials.push({ id, name: form.name })
        if (form.apiKey) secrets.set(id, form.apiKey)
        return ok(state)
      },
      [channels.openCodeActivateCredential]: (_e, id: string) => {
        state.activeCredentialId = id
        state.enabled = true
        state.authorizedModels = []
        return ok(state)
      },
      [channels.openCodeConfigure]: (_e, form) => {
        state.enabled = form.enabled
        return ok(state)
      },
      [channels.openCodeTest]: (_e, _id: string, options?: unknown) => {
        ;(globalThis as any).__openCodeTestCount =
          ((globalThis as any).__openCodeTestCount ?? 0) + 1
        // Synthetic results only; never dispatch real inference.
        if (options) {
          Object.assign(state, { error: 'FREE_TIER_RESTRICTED', httpStatus: 403 })
          Object.assign(state.models[0], {
            status: 'restricted',
            errorCode: 'FREE_TIER_RESTRICTED'
          })
        }
        return ok(state)
      }
    }
    for (const [channel, handler] of Object.entries(handlers)) {
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, handler)
    }
  }, IPC_INVOKE)
  await page.locator('a[href="#/models"]').click()
  await page.getByTestId('model-management-tab-opencode').click()
  await expect(page).toHaveURL(/tab=opencode/)
  const panel = page.getByTestId('opencode-free-panel')
  await expect(panel.getByTestId('opencode-model-test')).toHaveCount(0)
  await expect(panel.getByRole('status')).toHaveCount(0)
  const workspaceVisibility = panel.getByRole('switch', { name: '在工作区显示', exact: true })
  await expect(workspaceVisibility).not.toBeChecked()
  await page.locator('a[href="#/workspace"]').click()
  const modelTrigger = page.getByTestId('workspace-model-select').getByRole('button')
  const openCodeGroup = page.locator('[data-select-cascade-group="OpenCode"]')
  await modelTrigger.click()
  await expect(openCodeGroup).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.locator('a[href="#/models"]').click()
  await page.getByTestId('model-management-tab-opencode').click()
  await expect(page).toHaveURL(/tab=opencode/)
  await workspaceVisibility.click()
  await expect(workspaceVisibility).toBeChecked()
  await panel.getByTestId('opencode-model-paid-model').getByRole('switch').click()
  await expect(panel.getByTestId('opencode-model-paid-model').getByRole('switch')).toBeChecked()
  expect(await electronApp.evaluate(() => (globalThis as any).__openCodeVisibilityInput)).toEqual({
    showInWorkspace: true,
    modelIds: ['test', 'retired-model', 'paid-model']
  })
  expect(await electronApp.evaluate(() => (globalThis as any).__openCodeTestCount ?? 0)).toBe(0)
  await electronApp.evaluate(() => {
    ;(globalThis as any).__rejectOpenCodeVisibility = true
  })
  await panel.getByTestId('opencode-model-paid-model').getByRole('switch').click()
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: '模型不可用' })).toBeVisible()
  await expect(panel.getByTestId('opencode-model-paid-model').getByRole('switch')).toBeChecked()
  await electronApp.evaluate(() => {
    ;(globalThis as any).__rejectOpenCodeVisibility = false
  })

  await page.locator('a[href="#/workspace"]').click()
  await modelTrigger.click()
  await expect(openCodeGroup).toBeVisible()
  await openCodeGroup.click()
  const choices = page.getByTestId('composer-model-panel').getByRole('option')
  await expect(choices).toHaveCount(1)
  await expect(choices).toContainText('Paid fixture')
  await expect(choices).toBeDisabled()
  await expect(page.getByTestId('composer-model-panel')).not.toContainText('Other model')
  await page.keyboard.press('Escape')
  await page.locator('a[href="#/models"]').click()
  await page.getByTestId('model-management-tab-opencode').click()
  await expect(page).toHaveURL(/tab=opencode/)
  await expect(workspaceVisibility).toBeChecked()
  await workspaceVisibility.click()
  await expect(workspaceVisibility).not.toBeChecked()
  await page.locator('a[href="#/workspace"]').click()
  await modelTrigger.click()
  await expect(openCodeGroup).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.locator('a[href="#/models"]').click()
  await page.getByTestId('model-management-tab-opencode').click()
  await expect(page).toHaveURL(/tab=opencode/)
  const more = panel.getByTestId('opencode-more-actions').getByRole('button')
  await more.click()
  await expect(page.getByRole('menu')).toBeVisible()
  await panel.getByRole('heading', { name: '模型', exact: true }).click()
  await expect(page.getByRole('menu')).toHaveCount(0)
  await more.click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(more).toBeFocused()
  await more.click()
  const refreshBeforeMenu = await electronApp.evaluate(
    () => (globalThis as any).__openCodeRefreshCount
  )
  await page.getByRole('menuitem', { name: '刷新模型', exact: true }).click()
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect
    .poll(() => electronApp.evaluate(() => (globalThis as any).__openCodeRefreshCount))
    .toBe(refreshBeforeMenu + 1)
  await more.click()
  await page.getByRole('menuitem', { name: '测试连接', exact: true }).click()
  await expect(page.getByRole('menu')).toHaveCount(0)
  const connectionToast = page
    .locator('[data-sonner-toast]')
    .filter({ hasText: '连接成功，模型能力仍需验证' })
  await expect(connectionToast).toBeVisible()
  await expect(connectionToast).toContainText('HTTP 200')
  await expect(page.locator('[data-sonner-toaster]')).toHaveCSS('position', 'fixed')
  await expect(connectionToast).toHaveCSS('opacity', '1')
  const toastBox = (await connectionToast.boundingBox())!
  const viewport = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight
  }))
  expect(toastBox.x).toBeGreaterThanOrEqual(0)
  expect(toastBox.y).toBeGreaterThanOrEqual(0)
  expect(toastBox.x + toastBox.width).toBeLessThanOrEqual(viewport.width + 1)
  expect(toastBox.y + toastBox.height).toBeLessThanOrEqual(viewport.height + 1)
  await page.screenshot({ path: '/tmp/pi-harness-opencode-toast.png' })
  const verify = panel
    .getByTestId('opencode-model-paid-model')
    .getByRole('button', { name: '验证', exact: true })
  await expect(verify).toBeEnabled()
  await verify.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: '开始验证', exact: true })).toBeDisabled()
  await dialog.getByRole('switch').check()
  await expect(dialog.getByRole('button', { name: '开始验证', exact: true })).toBeEnabled()
  await dialog.getByRole('button', { name: '开始验证', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  const failureToast = page.locator('[data-sonner-toast]').filter({ hasText: '免费模型访问受限' })
  await expect(failureToast).toBeVisible()
  await expect(failureToast).toContainText('Paid fixture · HTTP 403')
  await expect(panel.getByRole('status')).toHaveCount(0)
  await panel.getByRole('button', { name: '显示 Personal', exact: true }).click()
  const key = dialog.getByLabel('官方 API Key', { exact: true })
  await expect(key).toHaveValue('fixture-personal-key')
  await expect(key).toHaveAttribute('type', 'text')
  await dialog.getByRole('button', { name: '隐藏', exact: true }).click()
  await expect(key).toHaveValue('')
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await panel.getByRole('button', { name: '添加 Key', exact: true }).click()
  await dialog.getByLabel('Key 名称', { exact: true }).fill('Work')
  await dialog.getByLabel('官方 API Key', { exact: true }).fill('fixture-work-key')
  await dialog.getByRole('switch').check()
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  const work = panel.getByTestId('opencode-credential-11111111-1111-1111-1111-111111111111')
  await expect(work).toContainText('Work')
  const refreshBeforeSwitch = await electronApp.evaluate(
    () => (globalThis as any).__openCodeRefreshCount
  )
  await work.getByRole('button', { name: '切换使用', exact: true }).click()
  await expect
    .poll(() => electronApp.evaluate(() => (globalThis as any).__openCodeRefreshCount))
    .toBe(refreshBeforeSwitch + 1)
  await expect(work).toContainText('当前使用')
  await expect(panel.getByRole('switch', { name: '启用', exact: true })).toHaveCount(0)
  await work.getByRole('button', { name: '停用', exact: true }).click()
  await expect(work).toContainText('已停用')
  await work.getByRole('button', { name: '恢复使用', exact: true }).click()
  await expect(work).toContainText('当前使用')
  const reason = panel
    .getByTestId('opencode-model-paid-model')
    .getByRole('button', { name: '查看原因', exact: true })
  await expect(reason).toBeEnabled()
  await reason.click()
  await expect(
    page.locator('[data-sonner-toast]').filter({ hasText: '模型访问权限不足' })
  ).toBeVisible()
  await panel.getByRole('button', { name: '一键验证所有模型', exact: true }).click()
  await expect(dialog).toContainText('模型访问权限不足 · 2')
  await expect(dialog.getByRole('button', { name: '开始验证', exact: true })).toBeDisabled()
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  for (const width of [1200, 1000]) {
    await page.setViewportSize({ width, height: 850 })
    const row = panel.getByTestId('opencode-model-paid-model')
    const actionCell = row.locator('td').last()
    await expect(row.getByRole('button', { name: '查看原因', exact: true })).toBeVisible()
    await expect(actionCell).toHaveCSS('white-space', 'nowrap')
    await expect(row.getByTestId('opencode-workspace-model-toggle')).toBeInViewport()
    expect(await actionCell.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
    await expect(row.getByTestId('opencode-workspace-model-toggle')).toHaveCSS(
      'white-space',
      'nowrap'
    )
  }
  await page.screenshot({ path: '/tmp/pi-harness-opencode-feedback.png' })
})

test('key and model lists scroll independently while their controls and table header stay visible', async ({
  page,
  electronApp
}) => {
  // Large synthetic lists exercise layout only; no credentials, Keychain access or inference.
  await electronApp.evaluate(({ ipcMain }, channels) => {
    const state = {
      schemaVersion: 2,
      enabled: true,
      authMode: 'inference',
      hasCredential: true,
      credentials: Array.from({ length: 30 }, (_, i) => ({
        id: i === 0 ? 'default' : `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        name: `Key ${i + 1}`
      })),
      activeCredentialId: 'default',
      showInWorkspace: true,
      workspaceModelIds: ['fixture-39'],
      connectionStatus: 'CONNECTED',
      httpStatus: 200,
      allowedPaidModels: [],
      authorizedModels: [],
      selectedModel: null,
      refreshedAt: Date.now(),
      error: null,
      models: Array.from({ length: 90 }, (_, i) => ({
        id: `fixture-${i}`,
        name: `Model ${i + 1}`,
        price: 'free',
        available: true,
        api: 'openai-completions',
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200000,
        maxTokens: 32000,
        input: ['text'],
        reasoning: false,
        streaming: 'not_verified',
        tools: 'not_verified',
        checkedAt: null,
        status: 'not_verified',
        errorCode: null
      }))
    }
    ipcMain.removeHandler(channels.openCodeState)
    ipcMain.handle(channels.openCodeState, () => ({ ok: true, data: state }))
    ipcMain.removeHandler(channels.openCodeRefresh)
    ipcMain.handle(channels.openCodeRefresh, () => ({ ok: true, data: state }))
  }, IPC_INVOKE)
  await page.locator('a[href="#/models"]').click()
  await page.getByTestId('model-management-tab-opencode').click()
  const panel = page.getByTestId('opencode-free-panel')
  const keys = panel.getByTestId('opencode-credentials-scroll')
  const models = panel.getByTestId('opencode-models-scroll')
  const addKey = panel.getByRole('button', { name: '添加 Key', exact: true })
  const search = panel.getByRole('searchbox', { name: '搜索模型', exact: true })
  await expect(models.locator('tbody tr').first()).toHaveAttribute(
    'data-testid',
    'opencode-model-fixture-39'
  )
  for (const size of [
    { width: 1440, height: 900 },
    { width: 1000, height: 700 }
  ]) {
    await page.setViewportSize(size)
    await keys.evaluate((el) => {
      el.scrollTop = 0
    })
    await models.evaluate((el) => {
      el.scrollTop = 0
    })
    for (const list of [keys, models]) {
      await expect(list).toHaveCSS('overflow-y', 'auto')
      await expect(list).toHaveCSS('overscroll-behavior-y', 'contain')
      expect(
        await list.evaluate((el) => el.scrollHeight > el.clientHeight && el.clientHeight > 80)
      ).toBe(true)
      const box = (await list.boundingBox())!
      expect(box.y).toBeGreaterThan(0)
      expect(box.y + box.height).toBeLessThan(size.height)
    }
    const initial = {
      add: (await addKey.boundingBox())!.y,
      search: (await search.boundingBox())!.y,
      header: (await models.locator('thead').boundingBox())!.y,
      panel: (await panel.boundingBox())!.y
    }
    await keys.hover()
    await page.mouse.wheel(0, 550)
    await expect.poll(() => keys.evaluate((el) => el.scrollTop)).toBeGreaterThan(100)
    expect(await models.evaluate((el) => el.scrollTop)).toBe(0)
    const keyScroll = await keys.evaluate((el) => el.scrollTop)
    await models.hover()
    await page.mouse.wheel(0, 700)
    await expect.poll(() => models.evaluate((el) => el.scrollTop)).toBeGreaterThan(100)
    expect(await keys.evaluate((el) => el.scrollTop)).toBe(keyScroll)
    expect((await addKey.boundingBox())!.y).toBeCloseTo(initial.add, 0)
    expect((await search.boundingBox())!.y).toBeCloseTo(initial.search, 0)
    expect((await models.locator('thead').boundingBox())!.y).toBeCloseTo(initial.header, 0)
    expect((await panel.boundingBox())!.y).toBeCloseTo(initial.panel, 0)
    await expect(addKey).toBeInViewport()
    await expect(search).toBeInViewport()
    expect(await panel.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true)
  }
  await page.screenshot({ path: '/tmp/pi-harness-opencode-local-scroll.png' })
})

test('batch verification confirms paid models once, shows progress, continues model failures and cancels the queue', async ({
  page,
  electronApp
}) => {
  await electronApp.evaluate(({ ipcMain }, channels) => {
    const control: any = { calls: [], refreshes: 0, cancels: 0, release: null }
    ;(globalThis as any).__openCodeBatch = control
    const state: any = {
      schemaVersion: 2,
      enabled: true,
      authMode: 'inference',
      hasCredential: true,
      credentials: [{ id: 'default', name: 'Fixture' }],
      activeCredentialId: 'default',
      showInWorkspace: false,
      workspaceModelIds: [],
      connectionStatus: 'CONNECTED',
      httpStatus: 200,
      allowedPaidModels: [],
      authorizedModels: ['free-one', 'free-two', 'paid-one'],
      selectedModel: null,
      refreshedAt: Date.now(),
      error: null,
      models: ['free-one', 'free-two', 'paid-one', 'unknown'].map((id) => ({
        id,
        name: id,
        price: id === 'unknown' ? 'unknown' : id === 'paid-one' ? 'paid' : 'free',
        available: true,
        api: 'openai-completions',
        cost: {
          input: id === 'paid-one' ? 1 : 0,
          output: id === 'paid-one' ? 2 : 0,
          cacheRead: 0,
          cacheWrite: 0
        },
        contextWindow: 200000,
        maxTokens: 32000,
        input: ['text'],
        reasoning: false,
        streaming: 'not_verified',
        tools: 'not_verified',
        checkedAt: null,
        status: 'not_verified',
        errorCode: null
      }))
    }
    const ok = () => ({ ok: true, data: state })
    const handlers: Record<string, (...args: any[]) => any> = {
      [channels.openCodeState]: ok,
      [channels.openCodeRefresh]: () => {
        control.refreshes++
        return ok()
      },
      [channels.openCodeCancel]: () => {
        control.cancels++
        state.error = 'REQUEST_CANCELLED'
        control.release?.()
        return { ok: true, data: undefined }
      },
      [channels.openCodeTest]: async (_e, id, options) => {
        control.calls.push({ id, options })
        state.error = null
        if (id === 'free-one')
          await new Promise<void>((resolve) => {
            control.release = resolve
          })
        if (state.error === 'REQUEST_CANCELLED') return ok()
        state.error = id === 'free-two' ? 'FREE_TIER_RESTRICTED' : null
        const model = state.models.find((item: any) => item.id === id)
        Object.assign(model, {
          status: state.error ? 'restricted' : 'ready',
          errorCode: state.error,
          streaming: state.error ? 'not_verified' : 'verified',
          tools: state.error ? 'not_verified' : 'verified'
        })
        if (id === 'paid-one' && options.allowPaid) state.allowedPaidModels.push(id)
        return ok()
      }
    }
    for (const [channel, handler] of Object.entries(handlers)) {
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, handler)
    }
  }, IPC_INVOKE)
  await page.locator('a[href="#/models"]').click()
  await page.getByTestId('model-management-tab-opencode').click()
  const panel = page.getByTestId('opencode-free-panel')
  await expect
    .poll(() => electronApp.evaluate(() => (globalThis as any).__openCodeBatch.refreshes))
    .toBe(1)
  // The selected price filter does not silently narrow "all models".
  await panel.getByRole('button', { name: '免费', exact: true }).click()
  const batch = panel.getByRole('button', { name: '一键验证所有模型', exact: true })
  await batch.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('将验证 3 个模型（其中付费 1 个），跳过 1 个。')
  await expect(dialog).toContainText('paid-one')
  const start = dialog.getByRole('button', { name: '开始验证', exact: true })
  await expect(start).toBeDisabled()
  await dialog.getByRole('switch').check()
  await start.click()
  await expect(panel.getByRole('status')).toContainText('free-one')
  await expect
    .poll(() => electronApp.evaluate(() => (globalThis as any).__openCodeBatch.calls.length))
    .toBe(1)
  await expect(batch).toBeDisabled()
  await page.screenshot({ path: '/tmp/pi-harness-opencode-batch-progress.png' })
  await electronApp.evaluate(() => (globalThis as any).__openCodeBatch.release())
  await expect(
    page
      .locator('[data-sonner-toast]')
      .filter({ hasText: '验证结束：通过 2，未通过 1，跳过 1，未验证 0' })
  ).toBeVisible()
  const calls = await electronApp.evaluate(() => (globalThis as any).__openCodeBatch.calls)
  expect(calls.map((call: any) => call.id)).toEqual(['free-one', 'free-two', 'paid-one'])
  expect(calls[2].options).toMatchObject({
    confirmInference: true,
    allowPaid: true,
    credentialId: 'default',
    expectedService: 'zen',
    expectedCost: { input: 1, output: 2 }
  })
  await batch.click()
  await dialog.getByRole('switch').check()
  await start.click()
  await expect
    .poll(() => electronApp.evaluate(() => (globalThis as any).__openCodeBatch.calls.length))
    .toBe(4)
  await panel.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: '已取消：' })).toBeVisible()
  await expect(batch).toBeEnabled()
  expect(
    await electronApp.evaluate(() => ({
      calls: (globalThis as any).__openCodeBatch.calls.length,
      cancels: (globalThis as any).__openCodeBatch.cancels
    }))
  ).toEqual({ calls: 4, cancels: 1 })
})

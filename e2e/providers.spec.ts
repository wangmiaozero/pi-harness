import { test, expect } from './fixtures'
import { IPC_INVOKE } from '../src/shared/ipc/channels'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { once } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'

test('keeps all configured providers selectable and handles local Ollama without a visible key', async ({
  page,
  piAgentDir
}, testInfo) => {
  const active = await page.evaluate(async () => {
    const api = window.piSwitch!
    const before = await api.models.getActive()
    await api.providers.create({
      key: 'ollama',
      name: 'ollama',
      displayName: 'Local Ollama fixture',
      enabled: false,
      protocol: 'openai-completions',
      baseUrl: 'http://127.0.0.1:11434/v1',
      apiKey: null,
      headers: {},
      authHeader: true,
      timeout: null,
      defaultModelId: 'fixture-local'
    })
    return before
  })
  await page.locator('a[href="#/models"]').click()
  await page.getByTestId('model-management-tab-providers').click()
  await expect(page.getByTestId('provider-row')).toHaveCount(3)
  await expect(page.getByRole('switch', { name: '启用', exact: true })).toHaveCount(0)
  const row = page.getByTestId('provider-row').filter({ hasText: 'Local Ollama fixture' })
  await expect(row).toContainText('无需密钥')
  await row.getByRole('button', { name: '编辑', exact: true }).click()
  let dialog = page.getByRole('dialog')
  await expect(dialog.getByTestId('ollama-no-key')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'API 密钥类型', exact: true })).toHaveCount(0)
  await expect(dialog.getByLabel('API 密钥', { exact: true })).toHaveCount(0)
  await dialog.screenshot({ path: testInfo.outputPath('local-ollama-no-key.png') })
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  const saved = JSON.parse(fs.readFileSync(path.join(piAgentDir, 'models.json'), 'utf8'))
  expect(saved.providers.ollama.apiKey).toBe('ollama')
  expect(saved.providers.ollama.authHeader).toBe(false)
  expect(await page.evaluate(() => window.piSwitch!.models.getActive())).toEqual(active)
  expect(
    (await page.evaluate(() => window.piSwitch!.providers.list())).every(
      (provider) => provider.enabled
    )
  ).toBe(true)

  await page.locator('a[href="#/workspace"]').click()
  const picker = page.getByTestId('workspace-model-select').getByRole('button')
  await picker.click()
  const vendors = page.getByTestId('composer-vendor-panel')
  await expect(vendors.getByRole('button')).toHaveCount(3)
  await expect(
    vendors.getByRole('button', { name: 'Local Ollama fixture', exact: true })
  ).toBeVisible()
  await vendors.getByRole('button', { name: 'Local Ollama fixture', exact: true }).hover()
  await page
    .getByTestId('composer-model-panel')
    .getByRole('option')
    .filter({ has: page.getByText('fixture-local', { exact: true }) })
    .click()
  await expect(picker).toContainText('fixture-local')
  const other = await page.evaluate(async () => {
    const providers = await window.piSwitch!.providers.list()
    const models = await window.piSwitch!.models.list()
    const model = models.find((item) => item.providerId !== 'ollama' && item.enabled)!
    return {
      vendor: providers.find((provider) => provider.id === model.providerId)!.displayName,
      model: model.displayName
    }
  })
  await picker.click()
  await vendors.getByRole('button', { name: other.vendor, exact: true }).hover()
  await page
    .getByTestId('composer-model-panel')
    .getByRole('option')
    .filter({ has: page.getByText(other.model, { exact: true }) })
    .click()
  await expect(picker).toContainText(other.model)
  await page.locator('a[href="#/models"]').click()
  await page.getByTestId('model-management-tab-providers').click()

  // Authenticated local services retain the normal credential controls.
  await row.getByRole('button', { name: '编辑', exact: true }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: '配置身份验证', exact: true }).click()
  await dialog.getByRole('button', { name: 'API 密钥类型', exact: true }).click()
  await page.getByRole('option', { name: '环境变量', exact: true }).click()
  await dialog.getByLabel('API 密钥', { exact: true }).fill('$OLLAMA_FIXTURE_KEY')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(row).not.toContainText('无需密钥')
  const updated = JSON.parse(fs.readFileSync(path.join(piAgentDir, 'models.json'), 'utf8'))
  expect(updated.providers.ollama.apiKey).toBe('$OLLAMA_FIXTURE_KEY')
  expect(updated.providers.ollama.authHeader).toBe(true)

  await page.evaluate(() => {
    window.location.hash = '#/settings/overview'
  })
  await expect(page.getByText('默认模型', { exact: true })).toBeVisible()
  await expect(
    page.getByText('用于未单独选择模型的会话；已选模型以工作台为准。', { exact: true })
  ).toBeVisible()
  await expect(page.getByTestId('overview-provider-count')).toHaveText('3')
})

test.describe('Providers', () => {
  test('keeps provider actions aligned and fixed to the right', async ({ page }) => {
    await expect(page.getByText('Pi-Harness').first()).toBeVisible({ timeout: 30_000 })
    await page.setViewportSize({ width: 960, height: 720 })
    await page.locator('a[href="#/models"]').click()
    await page.getByTestId('model-management-tab-providers').click()

    const table = page.getByTestId('providers-table-scroll')
    const actionCells = page.getByTestId('provider-action-cell')
    await expect(actionCells).toHaveCount(2)

    const before = await actionCells.evaluateAll((cells) =>
      cells.map((cell) => cell.getBoundingClientRect().left)
    )
    expect(new Set(before.map(Math.round)).size).toBe(1)

    await table.evaluate((element) => {
      element.scrollLeft = element.scrollWidth
    })
    const [tableBox, actionBox] = await Promise.all([
      table.boundingBox(),
      actionCells.first().boundingBox()
    ])
    expect(tableBox).not.toBeNull()
    expect(actionBox).not.toBeNull()
    expect(Math.abs(actionBox!.x + actionBox!.width - tableBox!.x - tableBox!.width)).toBeLessThan(
      3
    )
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

    await page.locator('a[href="#/models"]').click()
    await page.getByTestId('model-management-tab-providers').click()
    await page.getByTestId('add-provider').click()
    await page.getByTestId('add-provider-preset-deepseek').click()

    let dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel(/API 基础 URL|API Base URL/)).toBeHidden()
    await expect(dialog.getByLabel(/API 密钥$|API key$/)).toBeVisible()
    await dialog.getByTestId('provider-advanced-options').click()
    await expect(dialog.getByLabel(/提供商标识|Provider key/)).toHaveValue('deepseek')
    await expect(dialog.getByLabel(/显示名称|Display name/)).toHaveValue('DeepSeek')
    await expect(dialog.getByLabel(/内部名称|Internal name/)).toHaveValue('deepseek')
    await expect(dialog.getByLabel(/API 基础 URL|API Base URL/)).toHaveValue(
      'https://api.deepseek.com'
    )
    await expect(
      dialog.getByRole('button', { name: /API 密钥类型|API key type/, exact: true })
    ).toContainText(/明文|Literal/)
    await expect(dialog.getByLabel(/API 密钥$|API key$/)).toBeVisible()
    await expect(dialog.getByLabel(/默认模型 ID|Default model ID/)).toHaveValue('deepseek-flash')
    await dialog.getByLabel(/默认模型 ID|Default model ID/).click()
    const deepSeekPro = page
      .locator('[data-combobox-panel]')
      .getByRole('button', { name: /DeepSeek V4 Pro/ })
    await expect(deepSeekPro).toBeVisible()
    await deepSeekPro.click()
    await expect(dialog.getByLabel(/默认模型 ID|Default model ID/)).toHaveValue('deepseek-v4-pro')
    await dialog.getByRole('button', { name: /取消|Cancel/ }).click()

    await page.getByRole('button', { name: /新建提供商|New provider/ }).click()
    await page.getByTestId('add-provider-preset-openai-compatible').click()
    dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(/新建提供商|New provider/)
    await expect(dialog.getByRole('button', { name: /保存|Save/ })).toBeVisible()

    await page.mouse.click(5, 5)
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()

    const apiKeyType = dialog.getByRole('button', {
      name: /API 密钥类型|API key type/,
      exact: true
    })
    await apiKeyType.click()
    await page.getByRole('option', { name: /明文|Literal \(plaintext\)/, exact: true }).click()
    await expect(apiKeyType).toContainText(/明文|Literal \(plaintext\)/)

    await dialog.getByLabel(/API 基础 URL|Base URL/).fill('https://integrate.api.nvidia.com/v1')
    await expect(dialog.getByLabel(/提供商标识|Provider key/)).toHaveValue('nvidia')
    await expect(dialog.getByLabel(/显示名称|Display name/)).toHaveValue('NVIDIA')
    await expect(dialog.getByLabel(/内部名称|Internal name/)).toHaveValue('nvidia')
    await expect(dialog.getByLabel(/默认模型 ID|Default model ID/)).toHaveValue('z-ai/glm-5.2')
    await dialog
      .getByRole('button', { name: /根据 URL 生成标识与名称|Generate identity from URL/ })
      .click()
    await expect(dialog.getByLabel(/提供商标识|Provider key/)).toHaveValue('nvidia')
    await expect(dialog.getByLabel(/显示名称|Display name/)).toHaveValue('NVIDIA')
    await expect(dialog.getByLabel(/内部名称|Internal name/)).toHaveValue('nvidia')
    await expect(dialog.getByLabel(/默认模型 ID|Default model ID/)).toHaveValue('z-ai/glm-5.2')
    await expect(
      dialog.getByRole('button', { name: /一键获取全部模型|Fetch all models/ })
    ).toBeVisible()

    expect(pageErrors).toEqual([])
    expect(consoleErrors).toEqual([])
  })

  test('fetches all provider models and imports them on save', async ({ page }) => {
    const server = createServer((request, response) => {
      if (request.url?.startsWith('/empty/models')) {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ data: [] }))
        return
      }
      if (request.url?.startsWith('/failure/models')) {
        response.writeHead(404, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ error: { message: 'models endpoint unavailable' } }))
        return
      }
      if (request.url?.startsWith('/v1/models')) {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(
          JSON.stringify({
            data: [
              { id: 'acme-chat', name: 'Acme Chat' },
              { id: 'acme-reasoning', name: 'Acme Reasoning' }
            ]
          })
        )
        return
      }
      response.writeHead(404).end()
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')

    try {
      const port = (server.address() as AddressInfo).port
      await expect(page.getByText('Pi-Harness').first()).toBeVisible({ timeout: 30_000 })
      await page.locator('a[href="#/models"]').click()
      await page.getByTestId('model-management-tab-providers').click()
      await page.getByRole('button', { name: /新建提供商|New provider/ }).click()
    await page.getByTestId('add-provider-preset-openai-compatible').click()
      const dialog = page.getByRole('dialog')
      await dialog.getByLabel(/API 基础 URL|Base URL/).fill(`http://127.0.0.1:${port}/v1`)
      await dialog.getByRole('button', { name: /一键获取全部模型|Fetch all models/ }).click()

      await expect(dialog).toContainText(/保存后将导入 2 个模型|2 models will be imported on save/)
      await expect(dialog.getByLabel(/默认模型 ID|Default model ID/)).toHaveValue('acme-chat')
      await dialog.getByLabel(/默认模型 ID|Default model ID/).click()
      const modelPanel = page.locator('[data-combobox-panel]')
      await expect(modelPanel.getByRole('button', { name: /Acme Chat/ })).toBeVisible()
      await expect(modelPanel.getByRole('button', { name: /Acme Reasoning/ })).toBeVisible()

      await dialog.getByLabel(/API 基础 URL|Base URL/).fill(`http://127.0.0.1:${port}/empty`)
      await dialog.getByRole('button', { name: /一键获取全部模型|Fetch all models/ }).click()
      await expect(dialog.getByRole('status')).toContainText(
        /提供商没有返回任何模型|provider returned no models/
      )

      await dialog.getByLabel(/API 基础 URL|Base URL/).fill(`http://127.0.0.1:${port}/failure`)
      await dialog.getByRole('button', { name: /一键获取全部模型|Fetch all models/ }).click()
      await expect(dialog.getByRole('status')).toContainText(/获取模型失败|Failed to fetch models/)

      await dialog.getByLabel(/提供商标识|Provider key/).fill('acme-discovery')
      await dialog.getByLabel(/显示名称|Display name/).fill('Acme Discovery')
      await dialog.getByLabel(/内部名称|Internal name/).fill('acme-discovery')
      await dialog.getByLabel(/API 基础 URL|Base URL/).fill(`http://127.0.0.1:${port}/v1`)
      await dialog.getByRole('button', { name: /一键获取全部模型|Fetch all models/ }).click()
      await expect(dialog.getByRole('status')).toContainText(
        /保存后将导入 2 个模型|2 models will be imported on save/
      )
      await dialog.getByRole('button', { name: /保存|Save/, exact: true }).click()
      await expect(dialog).toBeHidden()
      const importedModels = await page.evaluate(() => window.piSwitch?.models.list())
      expect(importedModels?.filter((model) => model.providerId === 'acme-discovery')).toHaveLength(
        2
      )
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  })
})

test('ignores an old provider probe after changing dialogs and prevents duplicate probes', async ({
  page,
  electronApp
}) => {
  await electronApp.evaluate(({ ipcMain }, channel) => {
    const state = globalThis as typeof globalThis & {
      probeReplies: Array<(value: unknown) => void>
    }
    state.probeReplies = []
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, () => new Promise((resolve) => state.probeReplies.push(resolve)))
  }, IPC_INVOKE.providerTestConnection)
  await page.locator('a[href="#/models"]').click()
  await page.getByTestId('model-management-tab-providers').click()
  const cells = page.getByTestId('provider-action-cell')
  await cells
    .nth(0)
    .getByRole('button', { name: /^(测试|Test)$/ })
    .click()
  let dialog = page.getByRole('dialog')
  await expect(dialog).toContainText(/可能产生少量用量|may charge/)
  const start = dialog.getByRole('button', { name: /开始测试|Run test|Start test/ })
  const startElement = await start.elementHandle()
  await start.click()
  await startElement!.evaluate((button) => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await expect
    .poll(() =>
      electronApp.evaluate(
        () => (globalThis as typeof globalThis & { probeReplies: unknown[] }).probeReplies.length
      )
    )
    .toBe(1)
  await dialog
    .getByRole('button', { name: /关闭|Close/, exact: true })
    .last()
    .click()
  await cells
    .nth(1)
    .getByRole('button', { name: /^(测试|Test)$/ })
    .click()
  dialog = page.getByRole('dialog')
  await electronApp.evaluate(() => {
    const state = globalThis as typeof globalThis & {
      probeReplies: Array<(value: unknown) => void>
    }
    state.probeReplies[0]({
      ok: true,
      data: {
        ok: true,
        status: 'success',
        httpStatus: 200,
        latencyMs: 1,
        message: 'obsolete-probe-result'
      }
    })
  })
  await expect(dialog).not.toContainText('obsolete-probe-result')
  await expect(dialog.getByRole('button', { name: /开始测试|Run test|Start test/ })).toBeEnabled()
})

test('opens local accounts and usage without querying subscription models', async ({
  page,
  electronApp
}) => {
  await electronApp.evaluate(({ ipcMain }, channel) => {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, (_event, provider: string) => ({
      ok: true,
      data: {
        provider,
        source: 'minimax',
        kind: 'subscription',
        status: 'ok',
        checkedAt: Date.now(),
        windows: [
          {
            model: 'Fixture plan',
            window: 'current',
            remainingPercent: 52.25,
            resetAt: Date.now() + 60_000
          },
          { model: 'Fixture plan', window: 'weekly' }
        ]
      }
    }))
  }, IPC_INVOKE.providerQuota)
  await page.locator('a[href="#/models"]').click()
  await page.getByTestId('model-management-tab-providers').click()
  await expect(page.getByTestId('provider-tab-local')).toHaveCount(0)
  await page.getByTestId('add-provider').click()
  const catalog = page.getByTestId('add-provider-catalog')
  await expect(catalog.getByTestId('add-provider-subscription-chatgpt')).toBeVisible()
  await expect(catalog.getByTestId('add-provider-subscription-claude')).toBeVisible()
  await expect(catalog.getByTestId('add-provider-subscription-gemini')).toBeVisible()
  await expect(catalog.getByTestId('add-provider-subscription-copilot')).toBeVisible()
  await expect(catalog.getByTestId('add-provider-preset-deepseek')).toBeVisible()
  await expect(catalog.getByTestId('add-provider-preset-openai')).toBeVisible()
  await catalog.getByRole('searchbox', { name: '查找提供商' }).fill('deepseek')
  await expect(catalog.getByTestId('add-provider-preset-deepseek')).toBeVisible()
  await expect(catalog.getByTestId('add-provider-subscription-chatgpt')).toHaveCount(0)
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark'
  })
  await expect(catalog).toBeVisible()
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light'
  })
  await expect(catalog).toBeVisible()
  await catalog.getByRole('searchbox', { name: '查找提供商' }).fill('')
  await catalog.getByTestId('add-provider-subscription-chatgpt').click()
  await expect(catalog.getByTestId('chatgpt-connect')).toBeVisible()
  await catalog.getByTestId('add-provider-back').click()
  await catalog.getByTestId('add-provider-subscription-claude').click()
  await expect(catalog.getByText('Claude Code 的登录不能当作 Anthropic API Key', { exact: false })).toBeVisible()
  await expect(catalog.getByText('无法查询登录状态', { exact: true })).toHaveCount(1)
  await catalog.getByTestId('add-provider-back').click()
  await catalog.getByTestId('add-provider-subscription-copilot').click()
  await expect(catalog.getByTestId('subscription-limit-copilot')).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByTestId('provider-tab-usage').click()
  const usage = page.getByTestId('provider-usage-quota')
  await expect(usage.getByText('已记录请求', { exact: true })).toBeVisible()
  const balanceHeading = usage.getByRole('heading', { name: 'API 余额与额度' })
  await expect(balanceHeading).toBeVisible()
  await expect(usage.getByRole('heading', { name: '订阅额度' })).toBeVisible()
  await usage.getByRole('button', { name: '提供商', exact: true }).click()
  await page.getByRole('option').first().click()
  await usage.getByRole('button', { name: '刷新额度', exact: true }).click()
  await expect(usage.getByText('MiniMax Token Plan', { exact: false })).toBeVisible()
  const windows = usage.getByRole('listitem').filter({ hasText: 'Fixture plan' })
  await expect(windows).toHaveCount(2)
  await expect(windows.first()).toContainText('52.25%')
  await expect(windows.last()).toContainText('重置时间 —')
  await page.getByTestId('provider-tab-providers').click()
  await expect(page.getByTestId('provider-row')).toHaveCount(2)
})

test('shows the account catalogue and manages the default and allowed fallback', async ({
  page,
  electronApp
}) => {
  await electronApp.evaluate(
    ({ ipcMain }, channels) => {
      const model = {
        id: 'fixture-model',
        name: 'Account model',
        verified: true,
        contextWindow: 128_000
      }
      const accounts = ['primary', 'backup'].map((id) => ({
        id,
        label: id,
        status: 'authorized',
        catalogUpdatedAt: Date.now(),
        defaultModelId: undefined as string | undefined,
        fallbackRank: undefined as number | undefined,
        routingMode: 'ordered',
        models: [{ ...model, disabled: false }]
      }))
      const respond = (channel: string, run: (input: never) => unknown) => {
        ipcMain.removeHandler(channel)
        ipcMain.handle(channel, (_event, input) => ({ ok: true, data: run(input as never) }))
      }
      respond(channels.list, () => accounts)
      respond(channels.refresh, (id: string) => {
        accounts.find((account) => account.id === id)!.models[0].name = 'Refreshed account model'
      })
      respond(channels.defaultModel, (input: { id: string; modelId: string }) => {
        accounts.find((account) => account.id === input.id)!.defaultModelId = input.modelId
      })
      respond(channels.fallback, (input: { id: string; enabled: boolean }) => {
        accounts.find((account) => account.id === input.id)!.fallbackRank = input.enabled
          ? 1
          : undefined
      })
      respond(channels.enabled, (input: { id: string; enabled: boolean }) => {
        accounts.find((account) => account.id === input.id)!.models[0].disabled = !input.enabled
      })
      respond(channels.routing, (mode: string) => {
        accounts.find((account) => account.defaultModelId)!.routingMode = mode
      })
      respond(channels.label, (input: { id: string; label: string }) => {
        accounts.find((account) => account.id === input.id)!.label = input.label
      })
    },
    {
      list: IPC_INVOKE.chatGptAccounts,
      refresh: IPC_INVOKE.chatGptCatalogRefresh,
      defaultModel: IPC_INVOKE.chatGptDefaultModel,
      fallback: IPC_INVOKE.chatGptFallback,
      enabled: IPC_INVOKE.chatGptModelEnabled,
      routing: IPC_INVOKE.chatGptRoutingMode,
      label: IPC_INVOKE.chatGptLabel
    }
  )

  await page.locator('a[href="#/models"]').click()
  await page.getByTestId('model-management-tab-providers').click()
  await page.getByTestId('open-subscription-chatgpt').click()
  const accounts = page.getByTestId('provider-local-accounts').locator('article')
  const primary = accounts.filter({ hasText: 'ChatGPT · primary' })
  const backup = accounts.filter({ hasText: 'ChatGPT · backup' })
  await primary.getByRole('button', { name: '刷新模型' }).click()
  await expect(primary).toContainText('Refreshed account model')
  await primary.getByLabel('账户模型').fill('refreshed')
  await page
    .locator('[data-combobox-panel]')
    .getByRole('button', { name: /Refreshed account model/ })
    .click()
  await expect(primary).toContainText('上下文 128,000 token')
  await primary.getByRole('button', { name: '设为默认' }).click()
  await expect(primary).toContainText('新对话默认模型')
  await backup.getByRole('button', { name: '允许作为备用账户' }).click()
  await expect(backup).toContainText('备用顺序 1')
  const routing = page.getByRole('button', { name: '新对话账户路由', exact: true })
  await routing.click()
  await page.getByRole('option', { name: '在允许的账户之间轮转' }).click()
  await expect(routing).toContainText('在允许的账户之间轮转')
  await primary.getByRole('button', { name: '停用模型' }).click()
  await expect(primary.getByRole('button', { name: '验证模型' })).toBeDisabled()
  await expect(primary.getByRole('button', { name: '启用模型' })).toBeVisible()
  await backup.getByRole('button', { name: '移除备用账户' }).click()
  await expect(backup.getByRole('button', { name: '允许作为备用账户' })).toBeVisible()
  await backup.getByRole('button', { name: '重命名账户' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('账户名称').fill('Work account')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(accounts.filter({ hasText: 'ChatGPT · Work account' })).toBeVisible()
})

test('copies a saved provider key in Main without revealing it to the editor', async ({
  page,
  piAgentDir,
  electronApp
}) => {
  const fixtureKey = 'fixture-imported-provider-key'
  const file = path.join(piAgentDir, 'models.json')
  const models = JSON.parse(fs.readFileSync(file, 'utf8'))
  models.providers['openai-compatible'].apiKey = fixtureKey
  fs.writeFileSync(file, JSON.stringify(models))
  await electronApp.evaluate(({ clipboard }) => {
    const state = globalThis as typeof globalThis & { copiedFixtureKey?: string }
    clipboard.writeText = (text) => {
      state.copiedFixtureKey = text
    }
  })
  await page.locator('a[href="#/models"]').click()
  await page.getByTestId('model-management-tab-providers').click()
  const row = page.getByTestId('provider-row').filter({ hasText: 'OpenAI' })
  await row.getByRole('button', { name: '编辑', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: '复制已保存的 API 密钥' }).click()
  await expect
    .poll(() =>
      electronApp.evaluate(
        () => (globalThis as typeof globalThis & { copiedFixtureKey?: string }).copiedFixtureKey
      )
    )
    .toBe(fixtureKey)
  await expect(dialog.getByLabel('API 密钥', { exact: true })).not.toHaveValue(fixtureKey)
  const rejected = await page.evaluate(async () => {
    try {
      await window.piSwitch!.providers.copyApiKey('../invalid')
      return false
    } catch {
      return true
    }
  })
  expect(rejected).toBe(true)
})

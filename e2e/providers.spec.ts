import { test, expect, startFixtureSession } from './fixtures'
import { IPC_INVOKE } from '../src/shared/ipc/channels'
import { createServer, request as httpRequest } from 'node:http'
import type { AddressInfo } from 'node:net'
import { once } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'

for (const { key, name, subscription } of [
  { key: 'openai', name: 'OpenAI', subscription: null },
  { key: 'anthropic', name: 'Anthropic', subscription: 'claude' },
  { key: 'google', name: 'Google', subscription: 'gemini' }
] as const) {
  test(`adds and selects separate ${name} API accounts`, async ({ page, electronApp }) => {
    const modelId = 'fixture-shared-model'
    await electronApp.evaluate(({ clipboard }) => {
      process.env.PI_HARNESS_TEST_ACCOUNT_1 = 'fixture-first-credential'
      process.env.PI_HARNESS_TEST_ACCOUNT_2 = 'fixture-second-credential'
      clipboard.writeText = (text) => {
        Object.assign(globalThis, { copiedFixtureKey: text })
      }
    })
    await page.evaluate(async (provider) => {
      const { providers } = window.piSwitch
      if ((await providers.list()).some(({ key }) => key === provider)) {
        await providers.delete(provider, { overwrite: true })
      }
    }, key)
    await page.locator('a[href="#/models"]').click()

    const catalog = page.getByTestId('add-provider-catalog')
    const dialog = page.getByRole('dialog', { name: '新建提供商', exact: true })
    const editing = page.getByRole('dialog', { name: '编辑提供商', exact: true })
    for (const index of [1, 2]) {
      await page.getByTestId('add-provider').click()
      if (subscription) {
        await catalog.getByTestId(`add-provider-subscription-${subscription}`).click()
        await expect(catalog.locator('article')).toHaveCount(0)
        await catalog.getByTestId('subscription-use-api').click()
      } else {
        await catalog.getByTestId(`add-provider-preset-${key}`).click()
      }
      await expect(dialog).toBeVisible()
      await expect(editing).toHaveCount(0)
      await expect(dialog.getByLabel('API 密钥', { exact: true })).toHaveValue('')
      await expect(dialog.getByRole('button', { name: '复制已保存的 API 密钥' })).toHaveCount(0)
      await dialog.getByTestId('provider-advanced-options').click()
      await expect(dialog.getByLabel('提供商标识')).toHaveValue(index === 1 ? key : `${key}-2`)
      await expect(dialog.getByLabel('显示名称')).toHaveValue(index === 1 ? name : `${name} 2`)
      await dialog.getByRole('button', { name: 'API 密钥类型', exact: true }).click()
      await page.getByRole('option', { name: '环境变量', exact: true }).click()
      await dialog.getByLabel('API 密钥', { exact: true }).fill(`$PI_HARNESS_TEST_ACCOUNT_${index}`)
      await dialog.getByLabel('默认模型 ID').fill(modelId)
      await dialog.getByLabel('默认模型 ID').press('Escape')
      await dialog.getByRole('button', { name: '保存', exact: true }).click()
      await expect(dialog).toHaveCount(0)
    }

    const profiles = [
      { key, name, account: 1, secret: 'fixture-first-credential' },
      { key: `${key}-2`, name: `${name} 2`, account: 2, secret: 'fixture-second-credential' }
    ]
    for (const profile of profiles) {
      const row = page
        .getByTestId('provider-row')
        .filter({ has: page.getByText(profile.name, { exact: true }) })
      await row.getByRole('button', { name: '编辑', exact: true }).click()
      await expect(editing.getByLabel('API 密钥', { exact: true })).toHaveValue(
        `$PI_HARNESS_TEST_ACCOUNT_${profile.account}`
      )
      await page.evaluate((provider) => window.piSwitch.providers.copyApiKey(provider), profile.key)
      await expect
        .poll(() =>
          electronApp.evaluate(
            () => (globalThis as typeof globalThis & { copiedFixtureKey?: string }).copiedFixtureKey
          )
        )
        .toBe(profile.secret)
      if (key === 'openai' && profile.key !== key) {
        // Users can intentionally give two configurations the same display name.
        await editing.getByTestId('provider-advanced-options').click()
        await editing.getByLabel('显示名称').fill(name)
        await editing.getByRole('button', { name: '保存', exact: true }).click()
      } else {
        await editing.getByRole('button', { name: '取消', exact: true }).click()
      }
      await expect(editing).toHaveCount(0)
    }

    await page.locator('a[href="#/workspace"]').click()
    const picker = page.getByTestId('workspace-model-select').getByRole('button')
    const modelPanel = page.getByTestId('composer-model-panel')
    const vendors = page.getByTestId('composer-vendor-panel')
    for (const profile of profiles) {
      await picker.click()
      await modelPanel.getByRole('button', { name: '全部提供商' }).click()
      const group = key === 'openai' ? `${name} · ${profile.key}` : profile.name
      await vendors.getByRole('button', { name: group, exact: true }).hover()
      await modelPanel.getByRole('option', { name: modelId, exact: true }).click()
      await expect
        .poll(() => page.evaluate(() => window.piSwitch.models.getActive()))
        .toMatchObject({ providerKey: profile.key, modelId })
    }
  })
}

test('opens a fresh form for configured vendor, relay, local and custom presets', async ({
  page,
  electronApp,
  piAgentDir
}) => {
  const presetIds = ['deepseek', 'openrouter', 'ollama', 'openai-compatible']
  await page.evaluate(async (keys) => {
    const { providers } = window.piSwitch
    const existing = await providers.list()
    for (const key of keys) {
      if (existing.some((provider) => provider.key === key)) continue
      await providers.create({
        key,
        name: key,
        displayName: `Fixture ${key}`,
        protocol: 'openai-completions',
        baseUrl: 'http://127.0.0.1:9/v1',
        apiKey: { kind: 'env', envRef: '$FIXTURE_ORIGINAL_KEY' },
        headers: {},
        authHeader: true,
        enabled: true,
        timeout: null
      })
    }
  }, presetIds)
  await page.locator('a[href="#/models"]').click()
  const original = page.getByTestId('provider-row').filter({ hasText: 'Fixture openrouter' })
  await expect(original).toBeVisible()

  const catalog = page.getByTestId('add-provider-catalog')
  const create = page.getByRole('dialog', { name: '新建提供商', exact: true })
  const edit = page.getByRole('dialog', { name: '编辑提供商', exact: true })
  for (const id of presetIds) {
    await page.getByTestId('add-provider').click()
    await page.getByRole('searchbox', { name: '查找提供商' }).fill(id)
    await catalog.getByTestId(`add-provider-preset-${id}`).click()
    await expect(create).toBeVisible()
    await expect(edit).toHaveCount(0)
    if (id !== 'openai-compatible') {
      await create.getByTestId('provider-advanced-options').click()
    }
    await expect(create.getByLabel('提供商标识')).toHaveValue(`${id}-2`)
    await expect(create.getByRole('button', { name: '复制已保存的 API 密钥' })).toHaveCount(0)
    await create.getByRole('button', { name: '取消', exact: true }).click()
  }

  await electronApp.evaluate(
    ({ ipcMain }, { channel, file }) => {
      const fs = process.getBuiltinModule('node:fs')!
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, () => {
        const models = JSON.parse(fs.readFileSync(file, 'utf8'))
        const key = 'openrouter-fixture-authorized'
        models.providers[key] = { ...models.providers.openrouter, apiKey: '$FIXTURE_NEW_KEY' }
        fs.writeFileSync(file, JSON.stringify(models))
        return { ok: true, data: key }
      })
    },
    { channel: IPC_INVOKE.openRouterConnect, file: path.join(piAgentDir, 'models.json') }
  )
  await page.getByTestId('add-provider').click()
  await catalog.getByTestId('add-provider-subscription-openrouter').click()
  await catalog.getByTestId('openrouter-connect').click()
  await page.getByTestId('openrouter-connect-confirm').click()
  await expect(catalog).toHaveCount(0)
  await expect(edit).toHaveCount(0)
  await expect(original).toBeVisible()
  await expect(
    page.getByTestId('provider-row').filter({ hasText: 'openrouter-fixture-authorized' })
  ).toBeVisible()
})

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
  await page.getByTestId('composer-model-panel').getByRole('button', { name: '全部提供商' }).click()
  await expect(vendors.getByRole('button')).toHaveCount(4)
  await expect(vendors.getByRole('button', { name: '免费模型', exact: true })).toBeVisible()
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
  await page.getByTestId('composer-model-panel').getByRole('button', { name: '全部提供商' }).click()
  await vendors.getByRole('button', { name: other.vendor, exact: true }).hover()
  await page
    .getByTestId('composer-model-panel')
    .getByRole('option')
    .filter({ has: page.getByText(other.model, { exact: true }) })
    .click()
  await expect(picker).toContainText(other.model)
  await page.locator('a[href="#/models"]').click()

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
  test('persists advanced settings and sends them to a local upstream', async ({
    page,
    electronApp
  }) => {
    const calls: { authorization?: string; key?: string; payload: unknown }[] = []
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      calls.push({
        authorization: request.headers.authorization,
        key: String(request.headers['x-api-key']),
        payload: JSON.parse(Buffer.concat(chunks).toString())
      })
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }))
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    try {
      const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
      await page.locator('a[href="#/models"]').click()
      await page.getByTestId('add-provider').click()
      await page.getByTestId('add-provider-preset-openai-compatible').click()
      const dialog = page.getByRole('dialog')
      await dialog.getByLabel('API 基础 URL').fill(baseUrl)
      await dialog.getByLabel('提供商标识').fill('fixture-gateway')
      await dialog.getByLabel('显示名称').fill('Fixture Gateway')
      await dialog.getByLabel('默认模型 ID').fill('fixture-chat')
      await dialog.getByLabel('额外请求体').fill('{"fixture_flag":true}')
      await dialog.getByLabel('上下文窗口', { exact: true }).fill('200K')
      await dialog.getByLabel('最大输出', { exact: true }).fill('32K')
      await dialog.getByRole('button', { name: '保存', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      const result = await page.evaluate(async () => {
        const api = window.piSwitch!
        const provider = (await api.providers.list()).find(
          (item) => item.displayName === 'Fixture Gateway'
        )!
        const model = (await api.models.list()).find((item) => item.providerId === provider.id)
        const result = await api.providers.testConnection({
          providerKey: provider.key,
          modelId: 'fixture-chat'
        })
        return { provider, model, result }
      })
      expect(result.provider.advanced?.extraBody).toEqual({ fixture_flag: true })
      expect(result.model).toMatchObject({ contextWindow: 200_000, maxOutputTokens: 32_000 })
      expect(result.result.ok).toBe(true)
      expect(calls).toEqual([
        expect.objectContaining({
          payload: expect.objectContaining({
            fixture_flag: true,
            model: 'fixture-chat'
          })
        })
      ])
      await electronApp.evaluate(({ clipboard }) => {
        const fixture = globalThis as typeof globalThis & { gatewayFixtureKey?: string }
        clipboard.writeText = (value) => {
          fixture.gatewayFixtureKey = value
        }
      })
      await page.getByTestId('open-local-gateway').click()
      await page.getByRole('button', { name: '启动网关' }).click()
      const gateway = page.getByTestId('provider-local-gateway')
      await expect(gateway.getByRole('status')).toHaveText('网关运行中')
      await page.getByRole('button', { name: '复制网关密钥' }).click()
      await expect(gateway).toContainText('已复制网关密钥')
      const apiKey = await electronApp.evaluate(
        () => (globalThis as typeof globalThis & { gatewayFixtureKey?: string }).gatewayFixtureKey
      )
      const gatewayUrl = await gateway.locator('code').textContent()
      expect(await fetch(`${gatewayUrl}/models`).then((response) => response.status)).toBe(401)
      const headers = { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }
      const response = await fetch(`${gatewayUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: `${result.provider.key}/fixture-chat`,
          messages: [{ role: 'user', content: 'hello' }]
        })
      })
      expect(response.status).toBe(200)
      expect(await response.text()).toContain('OK')
      expect(calls.at(-1)?.payload).toMatchObject({ model: 'fixture-chat', fixture_flag: true })
      await page.getByRole('button', { name: '停止网关' }).click()
      await expect(page.getByRole('button', { name: '启动网关' })).toBeVisible()
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
  test('keeps provider actions aligned and fixed to the right', async ({ page }) => {
    await expect(page.getByText('Pi-Harness').first()).toBeVisible({ timeout: 30_000 })
    await page.setViewportSize({ width: 820, height: 720 })
    await page.locator('a[href="#/models"]').click()

    const table = page.getByTestId('providers-table-scroll')
    const actionCells = page.getByTestId('provider-action-cell')
    await expect(actionCells).toHaveCount(2)

    const before = await actionCells.evaluateAll((cells) =>
      cells.map((cell) => cell.getBoundingClientRect().left)
    )
    expect(new Set(before.map(Math.round)).size).toBe(1)

    expect(
      await table.evaluate((element) => element.scrollWidth - element.clientWidth)
    ).toBeGreaterThan(0)
    const [tableBefore, actionsBefore] = await Promise.all([
      table.boundingBox(),
      actionCells.first().boundingBox()
    ])
    expect(
      Math.abs(actionsBefore!.x + actionsBefore!.width - tableBefore!.x - tableBefore!.width)
    ).toBeLessThan(3)
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
    await expect(page.getByTestId('mask-provider-accounts')).toHaveCSS('border-top-width', '0px')
    await page.getByTestId('add-provider').click()
    await page.getByTestId('add-provider-preset-deepseek').click()

    let dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('button[data-variant="primary"]')).toHaveCSS(
      'border-top-width',
      '0px'
    )
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
  await expect(dialog.getByTestId('provider-connection-diagnostics')).toHaveCount(0)
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
  await expect(page.getByTestId('provider-tab-local')).toHaveCount(0)
  await page.getByTestId('add-provider').click()
  const catalog = page.getByTestId('add-provider-catalog')
  await expect(catalog.getByTestId('add-provider-subscription-chatgpt')).toBeVisible()
  await expect(catalog.getByTestId('add-provider-subscription-claude')).toBeVisible()
  await expect(catalog.getByTestId('add-provider-subscription-gemini')).toBeVisible()
  await expect(catalog.getByTestId('add-provider-subscription-copilot')).toBeVisible()
  await expect(catalog.getByTestId('add-provider-subscription-openrouter')).toBeVisible()
  await expect(catalog.getByTestId('add-provider-preset-deepseek')).toBeVisible()
  await expect(catalog.getByTestId('add-provider-preset-openai')).toBeVisible()
  const providerSearch = page.getByRole('searchbox', { name: '查找提供商' })
  await providerSearch.fill('deepseek')
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
  await providerSearch.fill('')
  await catalog.getByTestId('add-provider-subscription-chatgpt').click()
  await expect(catalog.getByTestId('chatgpt-connect')).toBeVisible()
  await catalog.getByTestId('add-provider-back').click()
  await catalog.getByTestId('add-provider-subscription-claude').click()
  await expect(
    catalog.getByText('配置 Anthropic API 密钥后，即可在 Pi 对话中使用 Claude。')
  ).toBeVisible()
  await expect(catalog.getByText('无法查询登录状态', { exact: true })).toHaveCount(1)
  const providerDialog = page.getByRole('dialog')
  const apiKey = providerDialog.getByLabel('API 密钥', { exact: true })
  const baseUrl = providerDialog.getByLabel('API 基础 URL', { exact: true })
  await catalog.getByTestId('subscription-use-api').click()
  await expect(apiKey).toBeVisible()
  await providerDialog.getByTestId('provider-advanced-options').click()
  await expect(baseUrl).toHaveValue(/^https:\/\/api\.anthropic\.com(?:\/|$)/)
  await providerDialog.getByRole('button', { name: '取消', exact: true }).click()
  await page.getByTestId('add-provider').click()
  await catalog.getByTestId('add-provider-subscription-gemini').click()
  await expect(
    catalog.getByText('配置 Gemini API 密钥后，即可在 Pi 对话中使用 Gemini。')
  ).toBeVisible()
  await catalog.getByTestId('subscription-use-api').click()
  await expect(apiKey).toBeVisible()
  await providerDialog.getByTestId('provider-advanced-options').click()
  await expect(baseUrl).toHaveValue(/^https:\/\/generativelanguage\.googleapis\.com(?:\/|$)/)
  await providerDialog.getByRole('button', { name: '取消', exact: true }).click()
  await page.getByTestId('add-provider').click()
  await catalog.getByTestId('add-provider-subscription-copilot').click()
  await expect(catalog.getByTestId('subscription-limit-copilot')).toHaveText(
    'Pi-Harness 暂未接入 GitHub Copilot 订阅登录。'
  )
  await catalog.getByTestId('add-provider-back').click()
  await providerSearch.fill('qwen cloud')
  await catalog.getByTestId('add-provider-preset-qwencloud-token-plan').click()
  await expect(providerDialog.getByLabel('API 密钥', { exact: true })).toBeVisible()
  await expect(providerDialog.getByTestId('provider-key-page')).toBeVisible()
  await providerDialog.getByTestId('provider-advanced-options').click()
  await expect(providerDialog.getByLabel('API 基础 URL', { exact: true })).toHaveValue(
    'https://token-plan.maas.qwencloudapi.com/compatible-mode/v1'
  )
  await providerDialog.getByRole('button', { name: '取消', exact: true }).click()
  await page.getByTestId('add-provider').click()
  await catalog.getByTestId('add-provider-subscription-openrouter').click()
  await expect(catalog.getByRole('button', { name: '通过 OpenRouter 继续' })).toBeVisible()
  await catalog.getByRole('button', { name: '改用 API 密钥' }).click()
  await expect(providerDialog.getByLabel('API 密钥', { exact: true })).toBeVisible()
  await providerDialog.getByRole('button', { name: '取消', exact: true }).click()
  await page.getByTestId('add-provider').click()
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
        verified: false,
        contextWindow: 128_000
      }
      const recommended = [
        { ...model, id: 'gpt-6.1-terra', name: 'GPT-6.1 Terra' },
        { ...model, id: 'gpt-6-astra', name: 'GPT-6 Astra' },
        { ...model, id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol' }
      ]
      const accounts = ['primary', 'backup'].map((id) => ({
        id,
        label: id,
        status: id === 'backup' ? 'expired' : 'authorized',
        catalogUpdatedAt: Date.now(),
        defaultModelId: undefined as string | undefined,
        fallbackRank: undefined as number | undefined,
        routingMode: 'ordered',
        models: [model, ...recommended].map((entry) => ({ ...entry, disabled: false }))
      }))
      const respond = (channel: string, run: (input: never) => unknown) => {
        ipcMain.removeHandler(channel)
        ipcMain.handle(channel, (_event, input) => ({ ok: true, data: run(input as never) }))
      }
      respond(channels.list, () => accounts)
      let resetApplied = false
      respond(channels.useReset, (id: string) => {
        if (id !== 'primary' || resetApplied) return 'noCredit'
        resetApplied = true
        return 'reset'
      })
      const allowanceCalls: string[] = []
      Object.assign(globalThis, { fixtureAllowanceCalls: allowanceCalls })
      ipcMain.removeHandler(channels.allowance)
      ipcMain.handle(channels.allowance, (_event, id: string) => {
        allowanceCalls.push(id)
        return id === 'primary'
          ? {
              ok: true,
              data: {
                plan: 'plus',
                windows: [
                  { seconds: 18_000, usedPercent: resetApplied ? 0 : 23 },
                  { seconds: 604_800, usedPercent: resetApplied ? 0 : 18 }
                ],
                resets: { count: resetApplied ? 0 : 1 }
              }
            }
          : {
              ok: false,
              error: {
                code: 'VALIDATION_ERROR',
                message: 'Reconnect your account.',
                details: { reason: 'authorization' }
              }
            }
      })
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
      respond(channels.selection, (input: { id: string; mode: string; modelIds: string[] }) => {
        const account = accounts.find((entry) => entry.id === input.id)!
        for (const model of account.models)
          model.disabled = input.mode !== 'catalog' && !input.modelIds.includes(model.id)
      })
      respond(channels.usage, (input: { provider: string; start: number; end: number }) => ({
        total: {
          requests: input.provider === 'primary' && input.end - input.start === 18_000_000 ? 2 : 7
        }
      }))
      respond(channels.routing, (mode: string) => {
        accounts.find((account) => account.defaultModelId)!.routingMode = mode
      })
      respond(channels.label, (input: { id: string; label: string }) => {
        accounts.find((account) => account.id === input.id)!.label = input.label
      })
      ipcMain.removeHandler(channels.verify)
      ipcMain.handle(channels.verify, (_event, input: { modelId: string }) =>
        input.modelId === 'gpt-6-astra'
          ? {
              ok: false,
              error: {
                code: 'VALIDATION_ERROR',
                message: 'Fixture',
                details: { reason: 'http', status: 403 }
              }
            }
          : { ok: true }
      )
      respond(channels.disconnect, (id: string) => {
        accounts.splice(
          accounts.findIndex((account) => account.id === id),
          1
        )
        return { revoked: false }
      })
    },
    {
      list: IPC_INVOKE.chatGptAccounts,
      allowance: IPC_INVOKE.chatGptAllowance,
      useReset: IPC_INVOKE.chatGptUseReset,
      refresh: IPC_INVOKE.chatGptCatalogRefresh,
      defaultModel: IPC_INVOKE.chatGptDefaultModel,
      fallback: IPC_INVOKE.chatGptFallback,
      enabled: IPC_INVOKE.chatGptModelEnabled,
      selection: IPC_INVOKE.chatGptModelSelection,
      usage: IPC_INVOKE.providerUsage,
      verify: IPC_INVOKE.chatGptVerify,
      disconnect: IPC_INVOKE.chatGptDisconnect,
      routing: IPC_INVOKE.chatGptRoutingMode,
      label: IPC_INVOKE.chatGptLabel
    }
  )

  await page.locator('a[href="#/models"]').click()
  const mask = page.getByTestId('mask-provider-accounts')
  await mask.click()
  await expect(mask).toHaveAttribute('aria-pressed', 'true')
  const table = page.getByTestId('providers-table-scroll')
  const accountRows = table
    .getByTestId('provider-row')
    .and(page.locator('[data-provider-kind="account"]'))
  await expect(table.getByTestId('provider-row')).toHaveCount(4)
  await expect(accountRows).toHaveCount(2)
  await expect(accountRows.first()).toContainText('Codex')
  await expect(accountRows.first()).toContainText('•••• mary')
  await expect(accountRows.first()).toContainText('OpenAI Responses')
  await expect(accountRows.first()).toContainText('ChatGPT Plus')
  await expect(accountRows.first()).toContainText('剩余 77%')
  await expect(accountRows.first()).toContainText('剩余 82%')
  await expect(accountRows.last()).toContainText('需要授权')
  const filter = page.getByRole('searchbox', { name: '筛选提供商…' })
  await filter.fill('primary')
  await expect(accountRows).toHaveCount(0)
  await filter.clear()
  await page.getByTestId('add-provider').click()
  const catalog = page.getByTestId('add-provider-catalog')
  await expect(catalog.getByTestId('provider-row')).toHaveCount(0)
  await catalog.getByTestId('add-provider-subscription-chatgpt').click()
  const accounts = page.getByTestId('provider-local-accounts').locator('article')
  await expect(catalog.getByTestId('chatgpt-connect')).toBeVisible()
  await expect(accounts).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.getByTestId('open-subscription-chatgpt').click()
  await expect(accounts.filter({ hasText: 'ChatGPT · •••• mary' })).toBeVisible()
  await expect(accounts.filter({ hasText: 'ChatGPT · primary' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(mask).toBeVisible()
  await mask.click()
  await filter.fill('backup')
  await expect(table.getByTestId('provider-row')).toHaveCount(1)
  await expect(accountRows).toHaveCount(1)
  await accountRows.getByRole('button', { name: '管理账户', exact: true }).click()
  const primary = accounts.filter({ hasText: 'ChatGPT · primary' })
  const backup = accounts.filter({ hasText: 'ChatGPT · backup' })
  await expect(accounts.first()).toContainText('ChatGPT · backup')
  await expect(backup).toContainText('请重新连接 ChatGPT 账户。')
  expect(
    await electronApp.evaluate(
      () =>
        (globalThis as typeof globalThis & { fixtureAllowanceCalls: string[] })
          .fixtureAllowanceCalls
    )
  ).toEqual(['primary', 'backup'])
  await expect(primary).toContainText('剩余 77%')
  await expect(primary).toContainText('剩余 82%')
  await expect(primary).toContainText('1 张重置卡')
  await primary.getByTestId('chatgpt-use-reset').click()
  const resetDialog = page.getByRole('dialog', { name: '使用一张重置卡？', exact: true })
  await resetDialog.getByRole('button', { name: '取消', exact: true }).click()
  await expect(primary).toContainText('1 张重置卡')
  await primary.getByTestId('chatgpt-use-reset').click()
  await resetDialog.getByTestId('chatgpt-use-reset-confirm').click()
  await expect(primary).toContainText('已使用一张重置卡')
  await expect(primary).toContainText('0 张重置卡')
  await expect(primary.getByText('剩余 100%', { exact: true })).toHaveCount(2)
  await primary.getByRole('button', { name: 'Pi-Harness 本地用量', exact: true }).click()
  await expect(primary).toContainText('最近 5 小时 2 次 · 最近 7 天 7 次')
  const picks = backup.getByTestId('chatgpt-model-preferences')
  const sol = picks.getByRole('button', { name: 'GPT-6.1 Sol', exact: true })
  await expect(sol).toHaveAttribute('aria-pressed', 'true')
  await picks.getByRole('button', { name: '全不选' }).click()
  await expect(sol).toHaveAttribute('aria-pressed', 'false')
  await picks.getByRole('button', { name: '保存', exact: true }).click()
  await expect(picks.getByRole('button', { name: '保存', exact: true })).toHaveCount(0)
  await expect(backup.getByRole('button', { name: '测试模型' })).toBeDisabled()
  await picks.getByRole('button', { name: '全选', exact: true }).click()
  await picks.getByRole('button', { name: '保存', exact: true }).click()
  await expect(picks.getByRole('button', { name: '保存', exact: true })).toHaveCount(0)
  await expect(sol).toHaveAttribute('aria-pressed', 'true')
  await expect(backup).not.toContainText('访问令牌已过期')
  await expect(primary.getByLabel('账户模型')).toHaveValue('gpt-6.1-terra')
  await primary.getByLabel('账户模型').click()
  const modelMenu = page.locator('[data-combobox-panel]')
  await expect(modelMenu.getByRole('button')).toHaveText([
    'GPT-6.1 Terra',
    'GPT-6.1 Sol',
    'GPT-6 Astra',
    'Account model'
  ])
  await page.keyboard.press('Escape')
  await primary.getByRole('button', { name: '测试模型' }).click()
  const modelTest = page.getByRole('dialog', { name: '测试模型', exact: true })
  await modelTest.getByRole('button', { name: '确认', exact: true }).click()
  await expect(modelTest.getByRole('status')).toHaveText('模型测试成功')
  await modelTest.getByRole('button', { name: '关闭', exact: true }).last().click()
  await primary.getByLabel('账户模型').click()
  await modelMenu.getByRole('button', { name: 'GPT-6 Astra' }).click()
  await primary.getByRole('button', { name: '测试模型' }).click()
  await modelTest.getByRole('button', { name: '确认', exact: true }).click()
  await expect(modelTest.getByRole('alert')).toHaveText('模型测试失败')
  await expect(modelTest).toContainText('HTTP 403')
  await modelTest.getByRole('button', { name: '关闭', exact: true }).last().click()
  await primary.getByRole('button', { name: '刷新模型' }).click()
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
  await expect(primary.getByRole('button', { name: '测试模型' })).toBeDisabled()
  await expect(primary.getByRole('button', { name: '启用模型' })).toBeVisible()
  await backup.getByRole('button', { name: '移除备用账户' }).click()
  await expect(backup.getByRole('button', { name: '允许作为备用账户' })).toBeVisible()
  await backup.getByRole('button', { name: '重命名账户' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('账户名称').fill('Work account')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(accounts.filter({ hasText: 'ChatGPT · Work account' })).toBeVisible()
  await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  await page.locator('a[href="#/workspace"]').click()
  const picker = page.getByTestId('workspace-model-select').getByRole('button')
  await picker.click()
  const modelPanel = page.getByTestId('composer-model-panel')
  await expect(modelPanel).toHaveAttribute('data-recommended', 'true')
  await expect(modelPanel.getByRole('button', { name: /默认/ })).toBeVisible()
  await modelPanel.getByRole('button', { name: '全部提供商' }).click()
  await page
    .getByTestId('composer-vendor-panel')
    .getByRole('button', { name: 'ChatGPT · Work account' })
    .hover()
  const chatOptions = page.getByTestId('composer-model-panel').getByRole('option')
  await expect(page.getByTestId('composer-model-panel')).not.toContainText('访问令牌已过期')
  await expect(chatOptions).toHaveText([
    'GPT-6.1 Terra',
    'GPT-6.1 Sol',
    'GPT-6 Astra',
    'Account model'
  ])
  await chatOptions.getByText('GPT-6.1 Terra').click()
  await expect(picker).toContainText('GPT-6.1 Terra')
  await picker.click()
  await expect(modelPanel.getByRole('option').first()).toHaveText('GPT-6.1 Terra')
  await page.keyboard.press('Escape')
  await page.locator('a[href="#/models"]').click()
  await page.getByTestId('open-subscription-chatgpt').click()
  await accounts
    .filter({ hasText: 'ChatGPT · Work account' })
    .getByRole('button', { name: '解除关联' })
    .click()
  await page
    .getByRole('dialog', { name: '确认', exact: true })
    .getByRole('button', { name: '确认', exact: true })
    .click()
  await expect(accounts.filter({ hasText: 'ChatGPT · Work account' })).toHaveCount(0)
  await expect(primary).toBeVisible()
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

test('reports actual proxy routes and copies safe diagnostics for gateway providers', async ({
  page,
  electronApp,
  workspaceRoot
}) => {
  const upstreamPaths: string[] = []
  const proxyPaths: string[] = []
  const upstream = createServer((request, response) => {
    upstreamPaths.push(request.url ?? '')
    response.writeHead(401, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: { message: 'fixture-private-response-string' } }))
  })
  upstream.listen(0, '127.0.0.1')
  await once(upstream, 'listening')
  const baseUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/v1`
  const automaticBaseUrl = 'http://proxy-only.invalid/v1'
  const proxy = createServer((request, response) => {
    proxyPaths.push(request.url ?? '')
    const target = new URL(request.url ?? '')
    expect([new URL(baseUrl).origin, new URL(automaticBaseUrl).origin]).toContain(target.origin)
    const forwarded = httpRequest(
      new URL(target.pathname, baseUrl),
      { method: request.method, headers: request.headers },
      (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers)
        upstreamResponse.pipe(response)
      }
    )
    forwarded.on('error', () => response.writeHead(502).end())
    request.pipe(forwarded)
  })
  proxy.listen(0, '127.0.0.1')
  await once(proxy, 'listening')
  const proxyUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`
  const close = (server: typeof proxy) =>
    new Promise<void>((resolve) => {
      server.close(() => resolve())
      server.closeAllConnections()
    })
  try {
    await electronApp.evaluate(async ({ session }, proxyUrl) => {
      for (const key of Object.keys(process.env))
        if (/^(?:https?|all|no)_proxy$/i.test(key)) delete process.env[key]
      process.env.PI_HARNESS_E2E_PROXY_KEY = 'fixture-auto-proxy-key'
      await session.defaultSession.setProxy({
        mode: 'fixed_servers',
        proxyRules: `${proxyUrl},direct://`,
        proxyBypassRules: '<-loopback>'
      })
    }, proxyUrl)
    const results = await page.evaluate(
      async ({ baseUrl, automaticBaseUrl }) => {
        const api = window.piSwitch!
        const common = {
          baseUrl,
          protocol: 'openai-responses' as const,
          apiKey: null,
          headers: {},
          authHeader: true,
          timeout: 5000
        }
        await api.providers.create({
          ...common,
          key: 'fixture-proxy',
          name: 'Fixture Proxy',
          displayName: 'Fixture Proxy',
          enabled: true,
          defaultModelId: 'fixture-model',
          baseUrl: automaticBaseUrl,
          apiKey: { kind: 'env', envRef: '$PI_HARNESS_E2E_PROXY_KEY' }
        })
        const modelId = 'fixture-model'
        const auto = await api.providers.testConnection({
          modelId,
          draft: { ...common, baseUrl: automaticBaseUrl }
        })
        const local = await api.providers.testConnection({ modelId, draft: common })
        const system = await api.providers.testConnection({
          modelId,
          draft: { ...common, advanced: { proxy: { mode: 'system' } } }
        })
        const direct = await api.providers.testConnection({
          modelId,
          draft: { ...common, advanced: { proxy: { mode: 'direct' } } }
        })
        return { auto, local, system, direct }
      },
      { baseUrl, automaticBaseUrl }
    )
    expect(results.auto).toMatchObject({
      status: 'auth_error',
      httpStatus: 401,
      network: {
        proxyMode: 'auto',
        transport: 'electron_fetch',
        automaticProxySource: 'system',
        proxyRoute: proxyUrl
      }
    })
    expect(results.local).toMatchObject({
      status: 'auth_error',
      network: { proxyMode: 'auto', transport: 'electron_fetch', proxyRoute: 'DIRECT' }
    })
    expect(results.system).toMatchObject({
      status: 'auth_error',
      httpStatus: 401,
      network: { proxyMode: 'system', transport: 'electron_fetch', proxyRoute: proxyUrl }
    })
    expect(results.direct).toMatchObject({
      status: 'auth_error',
      network: { proxyMode: 'direct', transport: 'electron_fetch', proxyRoute: 'DIRECT' }
    })
    expect(proxyPaths).toEqual([`${automaticBaseUrl}/responses`, `${baseUrl}/responses`])
    await electronApp.evaluate(({ clipboard }) => {
      const state = globalThis as typeof globalThis & { fixtureClipboard?: string }
      clipboard.writeText = (text) => {
        state.fixtureClipboard = text
      }
    })
    await page.locator('a[href="#/models"]').click()
    const row = page.getByTestId('provider-row').filter({ hasText: 'Fixture Proxy' })
    await row.getByRole('button', { name: '编辑', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '编辑提供商' })
    await dialog.getByTestId('provider-test-draft').click()
    const diagnostics = dialog.getByTestId('provider-connection-diagnostics')
    await expect(diagnostics).toContainText('HTTP 401')
    await expect(diagnostics).toContainText('系统代理')
    await expect(diagnostics).toContainText('Electron Fetch')
    await diagnostics.locator('summary').click()
    await expect(diagnostics).toContainText(proxyUrl)
    await diagnostics.getByRole('button', { name: '复制诊断信息' }).click()
    const copied = await electronApp.evaluate(
      () => (globalThis as typeof globalThis & { fixtureClipboard?: string }).fixtureClipboard
    )
    expect(copied).toBeDefined()
    expect(copied).not.toMatch(/fixture-private-response-string|fixture-auto-proxy-key/)
    expect(JSON.parse(copied!)).toMatchObject({
      providerKey: 'fixture-proxy',
      protocol: 'openai-responses',
      modelId: 'fixture-model',
      endpoint: `${automaticBaseUrl}/responses`,
      status: 'auth_error',
      latencyMs: expect.any(Number)
    })
    expect(proxyPaths.slice(2)).toEqual([`${automaticBaseUrl}/responses`])
    await dialog.getByRole('button', { name: '取消', exact: true }).last().click()
    await page.getByTestId('open-local-gateway').click()
    await page.getByRole('button', { name: '启动网关' }).click()
    const gateway = page.getByTestId('provider-local-gateway')
    await expect(gateway.getByRole('status')).toHaveText('网关运行中')
    const models = gateway.getByTestId('local-gateway-models')
    await models.locator('summary').click()
    const gatewayModel = models
      .getByRole('listitem')
      .filter({ hasText: 'fixture-proxy/fixture-model' })
    await expect(gatewayModel).toContainText('openai-responses')
    await page.getByRole('button', { name: '复制网关密钥' }).click()
    await expect(gateway).toContainText('已复制网关密钥')
    const key = await electronApp.evaluate(
      () => (globalThis as typeof globalThis & { fixtureClipboard?: string }).fixtureClipboard
    )
    const gatewayUrl = await gateway.locator('code').textContent()
    const response = await fetch(`${gatewayUrl}/responses`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'fixture-proxy/fixture-model', input: 'ping' })
    })
    expect(response.status).toBe(401)
    await response.body?.cancel()
    expect(proxyPaths.slice(3)).toEqual([`${automaticBaseUrl}/responses`])
    expect(upstreamPaths).toEqual(Array(6).fill('/v1/responses'))

    const { sessionId } = await startFixtureSession(page, {
      cwd: workspaceRoot,
      provider: 'fixture-proxy',
      modelId: 'fixture-model'
    })
    await page.evaluate(
      (id) =>
        window.piSwitch.agent.prompt({
          sessionId: id,
          message: 'Fixture model request through the automatic proxy'
        }),
      sessionId
    )
    await expect.poll(() => proxyPaths.slice(4)).toEqual([`${automaticBaseUrl}/responses`])
    await expect
      .poll(() =>
        page.evaluate(
          (id) => window.piSwitch.agent.running().then((ids) => ids.includes(id)),
          sessionId
        )
      )
      .toBe(false)

    await close(proxy)
    const failures = await page.evaluate(
      async ({ baseUrl, proxyUrl }) => {
        const api = window.piSwitch!
        return Promise.all([
          api.providers.testConnection({ providerKey: 'fixture-proxy' }),
          api.providers.testConnection({
            modelId: 'fixture-model',
            draft: {
              baseUrl,
              protocol: 'openai-responses',
              apiKey: null,
              headers: {},
              authHeader: true,
              timeout: 5000,
              advanced: { proxy: { mode: 'custom', url: proxyUrl } }
            }
          }),
          api.providers.testConnection({
            modelId: 'fixture-model',
            draft: {
              baseUrl,
              protocol: 'openai-responses',
              apiKey: null,
              headers: {},
              authHeader: true,
              timeout: 5000,
              advanced: { proxy: { mode: 'system' } }
            }
          })
        ])
      },
      { baseUrl, proxyUrl }
    )
    for (const failure of failures)
      expect(failure).toMatchObject({
        status: 'proxy_error',
        httpStatus: null,
        errorCode: 'ERR_PROXY_CONNECTION_FAILED'
      })
    expect(upstreamPaths).toHaveLength(7)
  } finally {
    await Promise.all([close(upstream), close(proxy)])
  }
})

test('cancels an in-flight provider probe from its connection dialog', async ({ page }) => {
  let notifyRequest!: () => void
  let notifyClose!: () => void
  const requestStarted = new Promise<void>((resolve) => {
    notifyRequest = resolve
  })
  const requestClosed = new Promise<void>((resolve) => {
    notifyClose = resolve
  })
  const upstream = createServer((request, response) => {
    response.once('close', notifyClose)
    request.resume()
    notifyRequest()
  })
  upstream.listen(0, '127.0.0.1')
  await once(upstream, 'listening')
  try {
    const baseUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/v1`
    await page.evaluate(
      (baseUrl) =>
        window.piSwitch!.providers.create({
          key: 'fixture-cancel',
          name: 'Fixture Cancel',
          displayName: 'Fixture Cancel',
          enabled: true,
          protocol: 'openai-completions',
          baseUrl,
          apiKey: null,
          headers: {},
          authHeader: true,
          timeout: null,
          defaultModelId: 'fixture-model'
        }),
      baseUrl
    )
    await page.locator('a[href="#/models"]').click()
    const row = page.getByTestId('provider-row').filter({ hasText: 'Fixture Cancel' })
    await row.getByRole('button', { name: /^(测试|Test)$/ }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: '开始测试' }).click()
    await requestStarted
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await requestClosed
    await expect(dialog.getByTestId('provider-connection-diagnostics')).toContainText(
      '连接测试已取消'
    )
    await expect(dialog.getByRole('button', { name: '开始测试' })).toBeEnabled()
  } finally {
    await new Promise<void>((resolve) => {
      upstream.close(() => resolve())
      upstream.closeAllConnections()
    })
  }
})

test('shows rejected request parameters in the provider editor without leaking the upstream response', async ({
  page,
  electronApp
}) => {
  const upstream = createServer((request, response) => {
    request.resume()
    response.writeHead(400, { 'content-type': 'application/json' })
    response.end(
      JSON.stringify({
        error: {
          code: 'unsupported_parameter',
          param: 'max_tokens',
          message: 'fixture-private-upstream-message'
        }
      })
    )
  })
  upstream.listen(0, '127.0.0.1')
  await once(upstream, 'listening')
  try {
    const baseUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/v1`
    await page.evaluate(
      (url) =>
        window.piSwitch!.providers.create({
          key: 'fixture-rejected-param',
          name: 'Fixture Rejected Parameter',
          displayName: 'Fixture Rejected Parameter',
          enabled: true,
          protocol: 'openai-completions',
          baseUrl: url,
          apiKey: null,
          headers: {},
          authHeader: true,
          timeout: null,
          defaultModelId: 'fixture-model'
        }),
      baseUrl
    )
    await electronApp.evaluate(({ clipboard }) => {
      const state = globalThis as typeof globalThis & { fixtureDiagnosticClipboard?: string }
      clipboard.writeText = (text) => {
        state.fixtureDiagnosticClipboard = text
      }
    })
    await page.locator('a[href="#/models"]').click()
    const row = page.getByTestId('provider-row').filter({ hasText: 'Fixture Rejected Parameter' })
    await row.getByRole('button', { name: '编辑', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '编辑提供商' })
    await dialog.getByTestId('provider-test-draft').click()
    const diagnostics = dialog.getByTestId('provider-connection-diagnostics')
    await expect(diagnostics).toContainText('HTTP 400')
    await expect(diagnostics).toContainText('上游拒绝了请求')
    await expect(diagnostics).toContainText('max_tokens')
    await diagnostics.locator('summary').click()
    await expect(diagnostics).toContainText('unsupported_parameter')
    await expect(diagnostics).not.toContainText('fixture-private-upstream-message')
    await diagnostics.getByRole('button', { name: '复制诊断信息' }).click()
    await expect
      .poll(() =>
        electronApp.evaluate(
          () =>
            (globalThis as typeof globalThis & { fixtureDiagnosticClipboard?: string })
              .fixtureDiagnosticClipboard
        )
      )
      .toContain('unsupported_parameter')
    const copied = await electronApp.evaluate(
      () =>
        (globalThis as typeof globalThis & { fixtureDiagnosticClipboard?: string })
          .fixtureDiagnosticClipboard
    )
    expect(JSON.parse(copied!)).toMatchObject({
      status: 'request_error',
      httpStatus: 400,
      upstreamError: { code: 'unsupported_parameter', parameter: 'max_tokens' }
    })
    expect(copied).not.toContain('fixture-private-upstream-message')
  } finally {
    await new Promise<void>((resolve) => {
      upstream.close(() => resolve())
      upstream.closeAllConnections()
    })
  }
})

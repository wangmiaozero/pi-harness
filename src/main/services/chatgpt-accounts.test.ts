// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { OAuthCredential } from '@earendil-works/pi-ai'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ChatGptAccounts } from './chatgpt-accounts'
import { latestChatGptModels } from '@shared/providers/account-management'

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  refresh: vi.fn(),
  streamSimple: vi.fn(),
  available: vi.fn(() => true)
}))

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: mocks.available,
    getSelectedStorageBackend: () => 'mock',
    encryptString: (value: string) => Buffer.from(value).reverse(),
    decryptString: (value: Buffer) => Buffer.from(value).reverse().toString()
  }
}))
vi.mock('@earendil-works/pi-ai/providers/openai', () => ({
  openaiProvider: () => ({
    auth: { oauth: { login: mocks.login, refresh: mocks.refresh } },
    getModels: () => [{ id: 'fixture-model', name: 'Fixture', input: ['text'], reasoning: false }],
    streamSimple: mocks.streamSimple
  })
}))

const openAuthorization = vi.fn(async (_url: string) => {})
const dirs: string[] = []
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 }))
  )
})
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})
async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), 'pi-harness-chatgpt-'))
  dirs.push(dir)
  const file = path.join(dir, 'accounts.json')
  return { file, accounts: new ChatGptAccounts(file) }
}

it('persists model visibility and rejects unsupported additions without changing the selection', async () => {
  const { accounts, file } = await fixture()
  mocks.login.mockResolvedValueOnce(grant('selection'))
  await accounts.connect(openAuthorization)
  const [{ id }] = await accounts.list()
  await accounts.setDefaultModel({ id, modelId: 'fixture-model' })
  const empty = { id, mode: 'usage' as const, modelIds: [], addedModelIds: [] }
  await accounts.setModelSelection(empty)
  const [disabled] = await new ChatGptAccounts(file).list()
  expect(disabled).toMatchObject({ modelMode: 'usage', models: [{ disabled: true }] })
  expect(disabled.defaultModelId).toBeUndefined()
  await expect(accounts.resolve(id, 'fixture-model')).rejects.toThrow('Reconnect')
  await expect(
    accounts.setModelSelection({ ...empty, mode: 'selected', addedModelIds: ['unsupported'] })
  ).rejects.toThrow('catalog')
  expect((await accounts.list())[0].modelMode).toBe('usage')
  await accounts.setModelSelection({ ...empty, mode: 'latest' })
  expect(await accounts.hasSelectableModel(id, 'fixture-model')).toBe(true)
  await accounts.setModelSelection({ ...empty, mode: 'catalog', routingOnly: true })
  await expect(accounts.isRoutingOnly(id)).resolves.toBe(true)
  await expect(accounts.setDefaultModel({ id, modelId: 'fixture-model' })).rejects.toThrow(
    'available ChatGPT model'
  )
  const response = await accounts.gatewayRequest(
    id,
    'fixture-model',
    {},
    new AbortController().signal
  )
  expect(response.status).toBe(404)
})

it('uses the newest version of each model family and preserves the recommended order', () => {
  const ids = [
    'gpt-5.6-terra',
    'gpt-6.1-sol',
    'gpt-6-astra',
    'gpt-6-sol',
    'gpt-6.1-terra',
    'gpt-5.6-luna',
    'gpt-6-luna'
  ]
  expect(latestChatGptModels(ids.map((id) => ({ id }))).map(({ id }) => id)).toEqual([
    'gpt-6.1-sol',
    'gpt-6-astra',
    'gpt-6.1-terra',
    'gpt-6-luna'
  ])
})

it('uses saved ChatGPT context limits and masks secrets on actual request bodies', async () => {
  const { accounts } = await fixture()
  mocks.login.mockResolvedValueOnce(grant('advanced'))
  await accounts.connect(openAuthorization)
  const [{ id }] = await accounts.list()
  await accounts.setGatewaySettings({
    contextWindows: { '*': 128000 },
    redactSecrets: true,
    billing: 'metered',
    priceMultiplier: 2
  })
  expect((await accounts.list())[0].models[0].contextWindow).toBe(128000)
  expect((await accounts.usageSettings())[id]).toMatchObject({
    billing: 'metered',
    priceMultiplier: 2
  })
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response('fixture'))
  vi.stubGlobal('fetch', fetcher)
  const privateKey = 'sk-' + 'x'.repeat(40)
  const result = await accounts.fetchResponses(id, 'fixture-model', {
    body: JSON.stringify({ input: [{ role: 'user', content: privateKey }] })
  })
  expect(await result.text()).toBe('fixture')
  expect(fetcher.mock.calls[0]?.[1]?.body).not.toContain(privateKey)
})

it('spends one weekly reset card and retries the request once', async () => {
  const { accounts } = await fixture()
  const payload = Buffer.from(
    JSON.stringify({
      email: 'owner@example.com',
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'acct_fixture',
        chatgpt_plan_type: 'plus'
      }
    })
  ).toString('base64url')
  mocks.login.mockResolvedValueOnce({ ...grant('reset'), access: `e30.${payload}.sig` })
  await accounts.connect(openAuthorization)
  const [{ id }] = await accounts.list()
  await accounts.setResetPolicy(id, { week: true, expiring: false, leadMinutes: 30 })
  let responses = 0
  let consumed = 0
  let allow = false
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/v1/responses')) {
        responses += 1
        if (allow) {
          allow = false
          return new Response('ok')
        }
        return Response.json(
          { error: { code: 'rate_limit_exceeded', message: 'limit' } },
          { status: 429 }
        )
      }
      if (url.endsWith('/wham/usage')) {
        return Response.json({
          plan_type: 'plus',
          rate_limit: {
            secondary_window: {
              used_percent: 100,
              limit_window_seconds: 604800,
              reset_at: 2_000_000_000
            }
          }
        })
      }
      if (url.endsWith('/consume')) {
        consumed += 1
        allow = true
        return Response.json({ code: 'reset' })
      }
      if (url.includes('rate-limit-reset-credits')) {
        return Response.json({
          available_count: 1,
          credits: [{ id: 'credit-1', status: 'available', expires_at: '2033-01-01T00:00:00Z' }]
        })
      }
      return new Response('unused', { status: 404 })
    })
  )
  const first = await accounts.fetchResponses(id, 'fixture-model', { body: '{"input":"hello"}' })
  expect(await first.text()).toBe('ok')
  expect(responses).toBe(2)
  expect(consumed).toBe(1)
  const second = await accounts.fetchResponses(id, 'fixture-model', { body: '{"input":"hello"}' })
  expect(second.status).toBe(429)
  expect(consumed).toBe(1)
})

it('transfers an encrypted account without replacing a destination registration', async () => {
  const source = await fixture()
  const target = await fixture()
  const backup = source.file + '.pihaccount'
  const password = 'fixture-transfer-password'
  mocks.login.mockResolvedValueOnce({ ...grant('transfer'), clientId: 'oaiapp_fixture' })
  await source.accounts.connect(openAuthorization)
  const [{ id, label }] = await source.accounts.list()
  await source.accounts.exportAccount(id, backup, password)
  const encrypted = await readFile(backup, 'utf8')
  expect(encrypted).not.toContain('fixture-access-transfer')
  expect(encrypted).not.toContain('oaiapp_fixture')
  await expect(target.accounts.importAccount(backup, 'wrong-password')).rejects.toThrow(
    'Incorrect password'
  )
  expect(await target.accounts.list()).toEqual([])
  await target.accounts.importAccount(backup, password)
  const [imported] = await target.accounts.list()
  expect(imported.id).not.toBe(id)
  expect(imported.label).toBe(label)
  await expect(target.accounts.importAccount(backup, password)).rejects.toThrow('already connected')
  expect(await target.accounts.list()).toHaveLength(1)
})
function grant(label: string, expires = Date.now() + 3_600_000): OAuthCredential {
  return {
    type: 'oauth',
    access: 'fixture-access-' + label,
    refresh: 'fixture-renew-' + label,
    expires,
    clientId: 'fixture-client'
  }
}

it('keeps registrations isolated, serializes refresh and removes disconnected grants', async () => {
  const { file, accounts } = await fixture()
  vi.useFakeTimers({ toFake: ['Date'] })
  mocks.login
    .mockResolvedValueOnce(grant('one', Date.now() + 120_000))
    .mockResolvedValueOnce(grant('two'))
  mocks.refresh.mockResolvedValue(grant('rotated'))
  mocks.streamSimple.mockReturnValue({
    result: async () => ({ stopReason: 'stop', content: [{ type: 'text', text: 'OK' }] })
  })
  await accounts.connect(openAuthorization)
  await accounts.connect(openAuthorization)
  vi.setSystemTime(Date.now() + 121_000)
  const [first, second] = await accounts.list()
  expect(first.id).not.toBe(second.id)
  expect(first.status).toBe('expired')
  expect(first.models[0].verified).toBe(false)
  await expect(accounts.resolve(first.id, 'fixture-model')).resolves.toBe('fixture-access-rotated')
  await Promise.all([
    accounts.verify(first.id, 'fixture-model'),
    accounts.verify(first.id, 'fixture-model')
  ])
  expect(mocks.refresh).toHaveBeenCalledTimes(1)
  expect(await accounts.resolve(first.id, 'fixture-model')).toBe('fixture-access-rotated')
  await accounts.setLabel(first.id, 'Work account')
  expect((await accounts.list())[0]).toMatchObject({
    label: 'Work account',
    lastUsedAt: Date.now()
  })
  expect(await accounts.hasSelectableModel(second.id, 'fixture-model')).toBe(true)
  expect(await new ChatGptAccounts(file).hasSelectableModel(first.id, 'fixture-model')).toBe(true)
  const serialized = await readFile(file, 'utf8')
  expect(serialized).not.toContain('fixture-access')
  expect(serialized).not.toContain('fixture-renew')
  expect(JSON.stringify(await accounts.list())).not.toContain('ciphertext')
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ revocation_endpoint: 'https://auth.openai.com/revoke' }))
    .mockResolvedValueOnce(new Response(null, { status: 200 }))
  vi.stubGlobal('fetch', fetcher)
  expect(await accounts.disconnect(first.id)).toEqual({ revoked: true })
  await expect(accounts.resolve(first.id, 'fixture-model')).rejects.toThrow('Reconnect')
  expect((await accounts.list()).map(({ id }) => id)).toEqual([second.id])
})

it('reports browser completion once, before the account is stored', async () => {
  const { accounts } = await fixture()
  const events: string[] = []
  mocks.login.mockImplementationOnce(
    async (interaction: { notify: (event: { type: string }) => void }) => {
      interaction.notify({ type: 'progress' })
      interaction.notify({ type: 'progress' })
      events.push('login-returned')
      return grant('saved')
    }
  )
  await accounts.connect(openAuthorization, () => events.push('exchange'))
  expect(events).toEqual(['exchange', 'login-returned'])
  expect(await accounts.list()).toHaveLength(1)
})

it('fails closed without secure storage and with failed model authorization', async () => {
  const { accounts } = await fixture()
  mocks.available.mockReturnValueOnce(false)
  await expect(accounts.connect(openAuthorization)).rejects.toThrow('Secure credential storage')
  expect(mocks.login).not.toHaveBeenCalled()
  mocks.login.mockResolvedValueOnce(grant('trial'))
  mocks.streamSimple.mockReturnValue({
    result: async () => ({ stopReason: 'error', errorMessage: 'private token', content: [] })
  })
  await accounts.connect(openAuthorization)
  const [item] = await accounts.list()
  await expect(accounts.verify(item.id, 'not-in-catalog')).rejects.toThrow('catalog')
  await expect(accounts.verify(item.id, 'fixture-model')).rejects.toThrow('could not verify')
  expect(await accounts.hasSelectableModel(item.id, 'fixture-model')).toBe(true)
})

it('discovers only listed account models and preserves verification across disable and refresh', async () => {
  const { accounts, file } = await fixture()
  mocks.login.mockResolvedValueOnce(grant('catalog'))
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () =>
    Response.json({
      models: [
        { slug: 'fixture-model', display_name: 'Account model', visibility: 'list' },
        { slug: 'hidden', display_name: 'Hidden', visibility: 'hide' },
        { slug: 'another-model', display_name: 'Another', visibility: 'list' }
      ]
    })
  )
  vi.stubGlobal('fetch', fetcher)
  mocks.streamSimple.mockReturnValue({
    result: async () => ({ stopReason: 'stop', content: [{ type: 'text', text: 'OK' }] })
  })
  await accounts.connect(openAuthorization)
  const [item] = await accounts.list()
  expect(fetcher).toHaveBeenCalledExactlyOnceWith(
    'https://api.openai.com/v1/models',
    expect.objectContaining({
      redirect: 'error',
      headers: { authorization: 'Bearer fixture-access-catalog', accept: 'application/json' }
    })
  )
  expect(item.catalogUpdatedAt).toBeDefined()
  expect(item.models).toMatchObject([
    { id: 'fixture-model', name: 'Account model', verified: false, unsupported: false },
    { id: 'another-model', unsupported: true }
  ])
  await accounts.verify(item.id, 'fixture-model')
  await accounts.setDefaultModel({ id: item.id, modelId: 'fixture-model' })
  expect((await new ChatGptAccounts(file).list())[0].defaultModelId).toBe('fixture-model')
  await accounts.setModelEnabled(item.id, 'fixture-model', false)
  await expect(accounts.resolve(item.id, 'fixture-model')).rejects.toThrow('Reconnect')
  await expect(accounts.setDefaultModel({ id: item.id, modelId: 'fixture-model' })).rejects.toThrow(
    'available ChatGPT model'
  )
  expect((await new ChatGptAccounts(file).list())[0].models[0]).toMatchObject({
    verified: true,
    disabled: true
  })
  await accounts.setModelEnabled(item.id, 'fixture-model', true)
  expect(await accounts.hasSelectableModel(item.id, 'fixture-model')).toBe(true)
  fetcher.mockResolvedValueOnce(Response.json({ models: [] }))
  await Promise.all([accounts.refreshCatalog(item.id), accounts.refreshCatalog(item.id)])
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect((await accounts.list())[0].models).toEqual([])
  expect(await accounts.hasSelectableModel(item.id, 'fixture-model')).toBe(false)
  fetcher.mockResolvedValueOnce(new Response(null, { status: 503 }))
  await expect(accounts.refreshCatalog(item.id)).rejects.toThrow('could not refresh')
  expect((await accounts.list())[0]).toMatchObject({
    models: [],
    catalogFailed: true,
    catalogIssue: { reason: 'http', status: 503 },
    defaultModelId: 'fixture-model'
  })
  await accounts.setDefaultModel(null)
  expect((await accounts.list())[0].defaultModelId).toBeUndefined()
})

it('accepts model list variants without exposing explicitly hidden entries', async () => {
  const { accounts } = await fixture()
  mocks.login.mockResolvedValueOnce(grant('variants'))
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({
        models: [
          { slug: 'fixture-model' },
          { slug: 'hidden', visibility: 'list' },
          { slug: 'hidden', visibility: 'hide' },
          { slug: 42 }
        ]
      })
    )
    .mockResolvedValueOnce(Response.json({ object: 'list', data: [{ id: 'fixture-model' }] }))
    .mockResolvedValueOnce(Response.json({ models: [{ slug: 42 }] }))
  vi.stubGlobal('fetch', fetcher)
  await accounts.connect(openAuthorization)
  const [account] = await accounts.list()
  expect(account.models.map(({ id, name }) => ({ id, name }))).toEqual([
    { id: 'fixture-model', name: 'Fixture' }
  ])
  await accounts.refreshCatalog(account.id)
  await expect(accounts.refreshCatalog(account.id)).rejects.toMatchObject({
    details: { reason: 'format' }
  })
  const [refreshed] = await accounts.list()
  expect(refreshed.models).toEqual(account.models)
  expect(refreshed.catalogIssue?.reason).toBe('format')
})

it('sends inference to the fixed Responses endpoint and reports transport and upstream failures', async () => {
  const { accounts } = await fixture()
  mocks.login.mockResolvedValueOnce(grant('responses'))
  await accounts.connect(openAuthorization)
  const [account] = await accounts.list()
  const modelId = 'fixture-model'
  const body = JSON.stringify({ model: modelId, input: 'Hello', stream: true, store: false })
  const fetcher = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new Error('ECONNREFUSED'))
    .mockResolvedValueOnce(
      Response.json(
        {
          error: {
            code: 'model_not_found',
            message: 'Model unavailable for fixture-access-responses'
          }
        },
        { status: 404 }
      )
    )
  vi.stubGlobal('fetch', fetcher)
  const failure = await accounts.fetchResponses(account.id, modelId, { body })
  expect(failure.status).toBe(502)
  expect(await failure.text()).toContain('could not connect to OpenAI')
  const rejected = await accounts.fetchResponses(account.id, modelId, { body })
  expect(rejected.status).toBe(404)
  expect(await rejected.json()).toEqual({
    error: { code: 'model_not_found', message: 'Model unavailable for [redacted]' }
  })
  expect(fetcher).toHaveBeenCalledWith(
    'https://api.openai.com/v1/responses',
    expect.objectContaining({
      body,
      redirect: 'error',
      headers: expect.objectContaining({ authorization: 'Bearer fixture-access-responses' })
    })
  )
  expect(mocks.streamSimple).not.toHaveBeenCalled()
})

it('routes new chats only to explicitly allowed accounts without testing each model', async () => {
  const { accounts, file } = await fixture()
  mocks.login
    .mockResolvedValueOnce(grant('primary'))
    .mockResolvedValueOnce(grant('backup'))
    .mockResolvedValueOnce(grant('unverified'))
    .mockResolvedValueOnce(grant('last'))
  mocks.streamSimple.mockReturnValue({
    result: async () => ({ stopReason: 'stop', content: [{ type: 'text', text: 'OK' }] })
  })
  for (let count = 0; count < 4; count++) await accounts.connect(openAuthorization)
  const [primary, backup, excluded, last] = await accounts.list()
  const modelId = 'fixture-model'
  await accounts.setModelEnabled(excluded.id, modelId, false)
  await accounts.setDefaultModel({ id: primary.id, modelId })
  await expect(accounts.setFallbackAccount(excluded.id, true)).rejects.toThrow('same enabled model')
  await expect(accounts.setFallbackAccount(primary.id, true)).rejects.toThrow('same enabled model')
  await accounts.setFallbackAccount(backup.id, true)
  await accounts.setFallbackAccount(last.id, true)
  expect((await new ChatGptAccounts(file).list()).map((account) => account.fallbackRank)).toEqual([
    undefined,
    1,
    undefined,
    2
  ])
  await expect(accounts.routeDefault()).resolves.toEqual({ provider: primary.id, modelId })
  await expect(accounts.routeDefault({ id: backup.id, modelId })).rejects.toThrow('model changed')
  await accounts.setRoutingMode('roundRobin')
  const routed = await Promise.all(
    Array.from({ length: 3 }, () => accounts.routeDefault({ id: primary.id, modelId }))
  )
  expect(routed.map((item) => item?.provider)).toEqual([primary.id, backup.id, last.id])
  expect((await new ChatGptAccounts(file).list())[0].routingMode).toBe('roundRobin')
  await accounts.setRoutingMode('ordered')
  await accounts.setModelEnabled(primary.id, modelId, false)
  await expect(accounts.routeDefault()).resolves.toEqual({ provider: backup.id, modelId })
  await accounts.setFallbackAccount(backup.id, false)
  await expect(accounts.routeDefault()).resolves.toEqual({ provider: last.id, modelId })
  await accounts.setModelEnabled(last.id, modelId, false)
  await expect(accounts.routeDefault()).rejects.toThrow('No authorized account')
  expect(mocks.streamSimple).not.toHaveBeenCalled()
  await accounts.setDefaultModel(null)
  await expect(accounts.routeDefault()).resolves.toBeNull()
  expect((await accounts.list()).every((account) => !account.fallbackRank)).toBe(true)
})

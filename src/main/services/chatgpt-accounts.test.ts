// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { OAuthCredential } from '@earendil-works/pi-ai'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ChatGptAccounts } from './chatgpt-accounts'

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
  await expect(accounts.resolve(first.id, 'fixture-model')).rejects.toThrow('Reconnect')
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
  expect(await accounts.hasVerifiedModel(second.id, 'fixture-model')).toBe(false)
  expect(await new ChatGptAccounts(file).hasVerifiedModel(first.id, 'fixture-model')).toBe(true)
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
  expect(await accounts.hasVerifiedModel(item.id, 'fixture-model')).toBe(false)
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
      headers: { authorization: 'Bearer fixture-access-catalog' }
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
    'verified and enabled'
  )
  expect((await new ChatGptAccounts(file).list())[0].models[0]).toMatchObject({
    verified: true,
    disabled: true
  })
  await accounts.setModelEnabled(item.id, 'fixture-model', true)
  expect(await accounts.hasVerifiedModel(item.id, 'fixture-model')).toBe(true)
  fetcher.mockResolvedValueOnce(Response.json({ models: [] }))
  await Promise.all([accounts.refreshCatalog(item.id), accounts.refreshCatalog(item.id)])
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect((await accounts.list())[0].models).toEqual([])
  expect(await accounts.hasVerifiedModel(item.id, 'fixture-model')).toBe(false)
  fetcher.mockResolvedValueOnce(new Response(null, { status: 503 }))
  await expect(accounts.refreshCatalog(item.id)).rejects.toThrow('could not refresh')
  expect((await accounts.list())[0]).toMatchObject({
    models: [],
    catalogFailed: true,
    defaultModelId: 'fixture-model'
  })
  await accounts.setDefaultModel(null)
  expect((await accounts.list())[0].defaultModelId).toBeUndefined()
})

it('routes new chats only to explicitly allowed and verified accounts in order', async () => {
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
  const [primary, backup, unverified, last] = await accounts.list()
  const modelId = 'fixture-model'
  for (const account of [primary, backup, last]) await accounts.verify(account.id, modelId)
  await accounts.setDefaultModel({ id: primary.id, modelId })
  await expect(accounts.setFallbackAccount(unverified.id, true)).rejects.toThrow(
    'verified and enabled'
  )
  await expect(accounts.setFallbackAccount(primary.id, true)).rejects.toThrow(
    'verified and enabled'
  )
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
  expect(mocks.streamSimple).toHaveBeenCalledTimes(3)
  await accounts.setDefaultModel(null)
  await expect(accounts.routeDefault()).resolves.toBeNull()
  expect((await accounts.list()).every((account) => !account.fallbackRank)).toBe(true)
})

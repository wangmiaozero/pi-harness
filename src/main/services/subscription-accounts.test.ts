// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { SubscriptionAccounts } from './subscription-accounts'

const mocks = vi.hoisted(() => ({ login: vi.fn(), available: vi.fn(() => true) }))

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: mocks.available,
    getSelectedStorageBackend: () => 'mock',
    encryptString: (value: string) => Buffer.from(value).reverse(),
    decryptString: (value: Buffer) => Buffer.from(value).reverse().toString()
  }
}))
vi.mock('@earendil-works/pi-ai/providers/anthropic', () => ({
  anthropicProvider: () => ({
    getModels: () => [{ id: 'claude-sonnet' }, { id: 'claude-opus' }],
    auth: { oauth: { login: mocks.login } }
  })
}))

const dirs: string[] = []
afterEach(async () => {
  delete process.env.PI_HARNESS_GEMINI_CLIENT_ID
  delete process.env.PI_HARNESS_GEMINI_CLIENT_SECRET
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), 'pi-harness-subscription-'))
  dirs.push(dir)
  return {
    dir,
    accounts: new SubscriptionAccounts(path.join(dir, 'accounts.json'), () =>
      path.join(dir, 'auth.json')
    )
  }
}

function grant() {
  return {
    type: 'oauth' as const,
    access: 'claude-access',
    refresh: 'claude-refresh',
    expires: Date.now() + 60_000
  }
}

it('stores a Claude browser sign-in and leaves an Anthropic API key in place', async () => {
  const { accounts, dir } = await fixture()
  const auth = path.join(dir, 'auth.json')
  await writeFile(
    auth,
    JSON.stringify({ anthropic: { type: 'api_key', key: 'sk-keep' }, openai: { type: 'api_key' } })
  )
  mocks.login.mockImplementation(async (interaction) => {
    expect(await interaction.prompt({ type: 'select', options: [] })).toBe('browser')
    interaction.notify({
      type: 'auth_url',
      url: 'https://claude.ai/oauth/authorize?code=true'
    })
    return grant()
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      expect(String(input)).toBe('https://api.anthropic.com/api/oauth/profile')
      return new Response(JSON.stringify({ email: 'claude@example.com' }), { status: 200 })
    })
  )
  const opened: string[] = []
  await accounts.connect('claude', async (url) => {
    opened.push(url)
  })
  expect(opened[0]).toContain('https://claude.ai/oauth/authorize')
  expect(await accounts.list()).toMatchObject([
    {
      provider: 'claude',
      email: 'claude@example.com',
      modelCount: 2,
      enabled: true,
      status: 'authorized'
    }
  ])
  expect(JSON.parse(await readFile(auth, 'utf8'))).toEqual({
    anthropic: { type: 'api_key', key: 'sk-keep' },
    openai: { type: 'api_key' }
  })
  expect(await readFile(path.join(dir, 'accounts.json'), 'utf8')).not.toContain('claude-access')
})

it('writes Claude OAuth into Pi auth when no API key is stored', async () => {
  const { accounts, dir } = await fixture()
  const auth = path.join(dir, 'auth.json')
  await writeFile(auth, JSON.stringify({ openai: { type: 'api_key', key: 'keep' } }))
  mocks.login.mockResolvedValue(grant())
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 404 }))
  )
  await accounts.connect('claude', async () => {})
  const [account] = await accounts.list()
  expect(JSON.parse(await readFile(auth, 'utf8'))).toMatchObject({
    openai: { type: 'api_key', key: 'keep' },
    anthropic: { type: 'oauth', refresh: 'claude-refresh' }
  })
  await accounts.disconnect(account.id)
  expect(JSON.parse(await readFile(auth, 'utf8'))).toEqual({
    openai: { type: 'api_key', key: 'keep' }
  })
  expect(await accounts.list()).toEqual([])
})

it('completes Gemini CLI sign-in from the loopback callback', async () => {
  process.env.PI_HARNESS_GEMINI_CLIENT_ID = 'test-gemini-client'
  process.env.PI_HARNESS_GEMINI_CLIENT_SECRET = 'test-gemini-secret'
  const { accounts } = await fixture()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = String(input)
      if (url.endsWith('/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'google-access',
            refresh_token: 'google-refresh',
            expires_in: 3600
          }),
          { status: 200 }
        )
      }
      if (url.includes('userinfo')) {
        return new Response(JSON.stringify({ email: 'gemini@example.com' }), { status: 200 })
      }
      if (url.endsWith('loadCodeAssist')) {
        return new Response(
          JSON.stringify({
            paidTier: { name: 'Gemini Code Assist' },
            cloudaicompanionProject: 'project-1'
          }),
          { status: 200 }
        )
      }
      if (url.endsWith('retrieveUserQuota')) {
        return new Response(
          JSON.stringify({
            buckets: [
              { modelId: 'gemini-2.5-pro' },
              { modelId: 'gemini-2.5-pro' },
              { modelId: 'gemini-2.5-flash' }
            ]
          }),
          { status: 200 }
        )
      }
      return new Response('{}', { status: 404 })
    })
  )
  await accounts.connect('gemini', async (url) => {
    const parsed = new URL(url)
    expect(parsed.origin).toBe('https://accounts.google.com')
    expect(parsed.searchParams.get('client_id')).toBe('test-gemini-client')
    const redirect = parsed.searchParams.get('redirect_uri')
    const state = parsed.searchParams.get('state')
    await new Promise<void>((resolve, reject) => {
      const req = request(`${redirect}?code=one-time&state=${state}`, (response) => {
        response.resume()
        response.on('end', () => resolve())
      })
      req.on('error', reject)
      req.end()
    })
  })
  expect(await accounts.list()).toMatchObject([
    {
      provider: 'gemini',
      email: 'gemini@example.com',
      plan: 'Gemini Code Assist',
      modelCount: 2,
      enabled: true
    }
  ])
})

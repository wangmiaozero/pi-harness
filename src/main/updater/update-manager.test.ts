// @vitest-environment node
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { signingFixture } from './security/signing-fixture'
import { ReleaseProvider } from './update-provider'
import { UpdateDownload } from './update-download'
import { UpdateManager } from './update-manager'
import { validatedUpgradeEvidence, installCapability } from './update-capabilities'
import type { UpdateStatus } from '@shared/update'
const temporary: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const dir of temporary.splice(0)) await fs.rm(dir, { recursive: true, force: true })
})
async function setup(
  platform = 'darwin',
  arch = 'arm64',
  variant = 'standard',
  mode: 'manual' | 'download' | 'automatic' = 'manual'
) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'update-manager-'))
  temporary.push(directory)
  const f = signingFixture('2.2.2')
  Object.assign(f.manifest, {
    releaseNotes: '### Fixed\n- Safe update <script>not executable</script>'
  })
  const bytes = f.encode(),
    signature = f.seal(bytes)
  const files = new Map<string, Buffer>([
    ['checksums.json', bytes],
    ['checksums.json.sig', signature],
    ...f.manifest.artifacts.map((i) => [i.file, f.payload] as [string, Buffer])
  ])
  const fetcher = vi.fn(async (url: string, _init?: RequestInit): Promise<Response> => {
    if (url.endsWith('/releases/latest'))
      return new Response(JSON.stringify({ tag_name: 'v2.2.2', draft: false, prerelease: false }))
    const bytes = files.get(new URL(url).pathname.split('/').pop()!)
    return bytes ? new Response(new Uint8Array(bytes)) : new Response(null, { status: 404 })
  })
  const options = {
    currentVersion: '2.2.1',
    platform,
    arch,
    variant,
    packaged: true,
    mode,
    directory,
    provider: new ReleaseProvider({ fetcher, platform, arch, variant, trust: f.trust }),
    downloader: new UpdateDownload({ directory: path.join(directory, 'downloads'), fetcher }),
    reveal: vi.fn(),
    install: vi.fn(),
    healthCheck: vi.fn(async () => {})
  }
  const manager = new UpdateManager(options)
  const states: UpdateStatus[] = []
  manager.onState((s) => states.push(s.status))
  return { f, files, fetcher, options, manager, states, bytes, signature, directory }
}
it.each([
  ['darwin', 'arm64', 'standard'],
  ['darwin', 'x64', 'nomascot'],
  ['win32', 'x64', 'standard'],
  ['linux', 'x64', 'nomascot']
])(
  'authenticates %s %s %s before download and exposes a verified manual installer',
  async (platform, arch, variant) => {
    const { manager, options, fetcher, states } = await setup(platform, arch, variant)
    expect(await manager.check()).toMatchObject({
      status: 'available',
      signature: 'verified',
      downloaded: false,
      totalBytes: 17
    })
    expect(fetcher.mock.calls.some(([url]) => /\.(dmg|exe|AppImage)$/.test(url))).toBe(false)
    const result = await manager.download()
    expect(result).toMatchObject({
      status: 'manual_fallback',
      integrity: 'verified',
      signature: 'verified',
      downloaded: true,
      canInstall: false,
      readiness: 'DOWNLOAD_VERIFIED',
      downloadProgress: 100
    })
    expect(states).toContain('verifying')
    await manager.reveal()
    expect(options.reveal).toHaveBeenCalledOnce()
    await expect(manager.install()).rejects.toMatchObject({ reason: 'INSTALL_UNVERIFIED' })
    manager.defer()
    expect(options.install).not.toHaveBeenCalled()
  }
)
it.each([
  'signature',
  'manifest',
  'wrong-key',
  'wrong-version',
  'arch',
  'variant',
  'tampered',
  'rollback'
])('refuses %s before fetching an installer', async (mode) => {
  const { manager, files, fetcher, f, options } = await setup()
  if (mode === 'signature') files.delete('checksums.json.sig')
  if (mode === 'manifest') files.delete('checksums.json')
  if (mode === 'wrong-key') files.set('checksums.json.sig', signingFixture('2.2.2').signature)
  if (mode === 'wrong-version') {
    f.manifest.version = '9.0.0'
    const b = f.encode()
    files.set('checksums.json', b)
    files.set('checksums.json.sig', f.seal(b))
  }
  if (mode === 'arch') options.arch = 'mips'
  if (mode === 'variant') options.variant = 'other'
  if (['arch', 'variant'].includes(mode))
    options.provider = new ReleaseProvider({
      fetcher,
      platform: options.platform,
      arch: options.arch,
      variant: options.variant,
      trust: f.trust
    })
  if (mode === 'tampered') files.set('checksums.json', Buffer.from('{}'))
  if (mode === 'rollback') options.currentVersion = '3.0.0'
  const instance = ['arch', 'variant', 'rollback'].includes(mode)
    ? new UpdateManager(options)
    : manager
  const state = await instance.check()
  expect(state.signature).not.toBe('verified')
  expect(state.canInstall).toBe(false)
  expect(fetcher.mock.calls.some(([url]) => url.endsWith('.dmg'))).toBe(false)
})
it('rejects post-download tampering on reveal and never calls install', async () => {
  const { manager, options } = await setup()
  await manager.check()
  await manager.download()
  await manager.reveal()
  const file = options.reveal.mock.calls[0][0]
  await fs.writeFile(file, 'corrupt')
  await expect(manager.reveal()).rejects.toMatchObject({ reason: 'INTEGRITY_FAILED' })
  expect(manager.snapshot()).toMatchObject({
    status: 'failed',
    downloaded: false,
    canInstall: false
  })
  expect(options.install).not.toHaveBeenCalled()
})
it('re-authenticates every retry and rejects a changed release manifest', async () => {
  const { manager, files, f } = await setup()
  await manager.check()
  Object.assign(f.manifest, { releaseNotes: 'changed' })
  const bytes = f.encode()
  files.set('checksums.json', bytes)
  files.set('checksums.json.sig', f.seal(bytes))
  expect(await manager.download()).toMatchObject({
    status: 'failed',
    error: { code: 'MANIFEST_CHANGED' },
    downloaded: false
  })
})
it('cancels during signature re-authentication without treating cancellation as a missing signature', async () => {
  const { manager, fetcher } = await setup()
  await manager.check()
  let waiting = false
  fetcher.mockImplementationOnce(async (_url, init) => {
    waiting = true
    return new Promise<Response>((_resolve, reject) =>
      init!.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    )
  })
  const download = manager.download()
  await vi.waitFor(() => expect(waiting).toBe(true))
  expect(await manager.cancel()).toMatchObject({
    status: 'available',
    downloaded: false,
    canInstall: false,
    signature: 'verified',
    error: { code: 'DOWNLOAD_CANCELLED' }
  })
  await download
})
it('does not let automatic policy or user preferences bypass native installer evidence', async () => {
  const { manager, options } = await setup('win32', 'x64', 'standard', 'automatic')
  await manager.preferences({ autoCheck: false, autoDownload: true })
  expect(await manager.check()).toMatchObject({
    downloaded: true,
    canInstall: false,
    status: 'manual_fallback'
  })
  await expect(manager.install()).rejects.toThrow('Automatic installation')
  expect(options.install).not.toHaveBeenCalled()
})
it('requires download consent under the unchanged manual release policy', async () => {
  const { manager, fetcher } = await setup()
  await manager.preferences({ autoCheck: false, autoDownload: true })
  expect(await manager.check()).toMatchObject({
    status: 'available',
    downloaded: false,
    autoDownloadAllowed: false
  })
  expect(fetcher.mock.calls.some(([url]) => url.endsWith('.dmg'))).toBe(false)
})
it('persists auto-check opt-out and rejects extra preference fields', async () => {
  const { manager, options, fetcher } = await setup()
  await manager.preferences({ autoCheck: false, autoDownload: false })
  const reopened = new UpdateManager(options)
  reopened.start(0)
  await new Promise((resolve) => setTimeout(resolve, 20))
  reopened.stop()
  expect(reopened.snapshot().preferences.autoCheck).toBe(false)
  expect(fetcher).not.toHaveBeenCalled()
  await expect(
    manager.preferences({
      autoCheck: true,
      autoDownload: true,
      url: 'https://evil.example'
    } as never)
  ).rejects.toThrow()
})
it('rejects all incomplete, foreign or non-native automatic upgrade evidence', () => {
  for (const platform of ['darwin', 'win32', 'linux'])
    for (const arch of ['arm64', 'x64'])
      expect(installCapability(platform, arch, 'standard', '2.2.1', '2.2.2').canInstall).toBe(false)
  expect(
    validatedUpgradeEvidence(
      { native: false },
      { platform: 'win32', arch: 'x64', variant: 'standard', from: '2.2.1', to: '2.2.2' }
    )
  ).toBe(false)
})
it('reports completion only after the target version actually starts and passes health checks', async () => {
  const { options, directory } = await setup()
  await fs.writeFile(
    path.join(directory, 'upgrade.json'),
    JSON.stringify({
      schemaVersion: 1,
      fromVersion: '2.2.0',
      toVersion: '2.2.1',
      variant: 'standard',
      status: 'launched'
    })
  )
  const manager = new UpdateManager(options)
  await manager.preferences({ autoCheck: false, autoDownload: false })
  expect(manager.snapshot().status).toBe('completed')
  expect(options.healthCheck).toHaveBeenCalledOnce()
})

it('reports verification while a manual upgrade startup health check is still running', async () => {
  const { options, directory } = await setup()
  await fs.writeFile(
    path.join(directory, 'upgrade.json'),
    JSON.stringify({
      schemaVersion: 1,
      fromVersion: '2.2.0',
      toVersion: options.currentVersion,
      variant: 'standard',
      status: 'prepared',
      mode: 'manual'
    })
  )
  let finish!: () => void
  const health = new Promise<void>((resolve) => {
    finish = resolve
  })
  options.healthCheck.mockImplementation(() => health)
  const manager = new UpdateManager(options)
  const initializing = manager.preferences({ autoCheck: false, autoDownload: false })
  try {
    await vi.waitFor(() => expect(options.healthCheck).toHaveBeenCalledOnce())
    expect(manager.snapshot()).toMatchObject({ status: 'verifying', canInstall: false })
    expect(JSON.parse(await fs.readFile(path.join(directory, 'upgrade.json'), 'utf8')).status).toBe(
      'prepared'
    )
  } finally {
    finish()
    await initializing
  }
  expect(manager.snapshot().status).toBe('completed')
})

it.each(['healthy', 'unhealthy'])(
  'state requests await the shared %s startup check',
  async (outcome) => {
    const { options, directory, fetcher } = await setup()
    const journal = {
      schemaVersion: 1,
      fromVersion: '2.2.0',
      toVersion: options.currentVersion,
      variant: 'standard',
      status: 'prepared',
      mode: 'manual'
    }
    const journalPath = path.join(directory, 'upgrade.json')
    await fs.writeFile(journalPath, JSON.stringify(journal))
    let finish!: () => void
    const health = new Promise<void>((resolve, reject) => {
      finish = () =>
        outcome === 'healthy' ? resolve() : reject(new Error('Invalid runtime bytes'))
    })
    options.healthCheck.mockImplementation(() => health)
    const manager = new UpdateManager(options)
    let delivered = false
    const first = manager.readState().then((state) => {
      delivered = true
      return state
    })
    const second = manager.readState()
    try {
      await vi.waitFor(() => expect(options.healthCheck).toHaveBeenCalledOnce())
      expect(delivered).toBe(false)
      expect(manager.snapshot()).toMatchObject({ status: 'verifying', canInstall: false })
      expect(JSON.parse(await fs.readFile(journalPath, 'utf8'))).toEqual(journal)
    } finally {
      finish()
      await Promise.all([first, second])
    }
    const state = await first
    expect(state).toEqual(await second)
    expect(state.canInstall).toBe(false)
    expect(options.healthCheck).toHaveBeenCalledOnce()
    expect(fetcher).not.toHaveBeenCalled()
    const saved = JSON.parse(await fs.readFile(journalPath, 'utf8'))
    if (outcome === 'healthy') {
      expect(state.status).toBe('completed')
      expect(saved.status).toBe('completed')
    } else {
      expect(state).toMatchObject({
        status: 'manual_fallback',
        error: { code: 'HEALTH_CHECK_FAILED' }
      })
      expect(saved).toEqual(journal)
    }
  }
)

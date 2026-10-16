// @vitest-environment node
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import {
  validateVersion,
  changelogSection,
  assetNames,
  metadataName,
  validateMetadata,
  digest
} from '../../../scripts/release/policy.mjs'
import { publishRelease } from '../../../scripts/release/publish.mjs'
import { collect } from '../../../scripts/release/collect.mjs'
const temporary: string[] = []
it('uses the builder Linux ARM64 metadata suffix without changing existing feeds', () => {
  expect(metadataName('linux-arm64', 'standard')).toBe('latest-linux-arm64.yml')
  expect(metadataName('linux-arm64', 'nomascot')).toBe('nomascot-linux-arm64.yml')
  expect(metadataName('darwin-arm64', 'standard')).toBe('latest-mac.yml')
  expect(metadataName('win32-arm64', 'standard')).toBe('latest.yml')
})
afterEach(async () => {
  for (const directory of temporary.splice(0))
    await fs.rm(directory, { recursive: true, force: true })
})
async function directory() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'community-release-'))
  temporary.push(dir)
  return dir
}
it('protects the historical release and rejects noncanonical or mismatched tags', () => {
  for (const tag of ['v2.0.0', 'v02.0.1', 'v2.0.1-beta.1', 'v2.0.1/extra', 'v2.0.2'])
    expect(() => validateVersion('2.0.1', tag)).toThrow()
  expect(() => validateVersion('2.0.1', 'v2.0.1')).not.toThrow()
  expect(() => validateVersion('2.0.0', 'v2.0.0')).toThrow('protected')
  expect(() => changelogSection('## Unreleased\n### Added\n- future', '2.0.1')).toThrow()
  expect(
    changelogSection('## 2.0.1 — 2026-10-16\n### Fixed\n- Real fix\n## 2.0.0 — 2026-10-14', '2.0.1')
  ).not.toContain('2.0.0')
})
it('keeps all supported installer names unique across architectures and variants', () => {
  const names = [
    'darwin-arm64',
    'darwin-x64',
    'win32-x64',
    'win32-arm64',
    'linux-x64',
    'linux-arm64'
  ].flatMap((platform) =>
    ['standard', 'nomascot'].flatMap((variant) => assetNames('2.0.1', platform, variant))
  )
  expect(new Set(names).size).toBe(names.length)
  expect(names).toContain('Pi-Harness-Setup-2.0.1.exe')
  expect(names).toContain('Pi-Harness-2.0.1-mac.zip')
})
it('validates generated payload bytes and rejects wrong variant or unsafe metadata', async () => {
  const dir = await directory()
  const file = 'Pi-Harness-Setup-2.0.1.exe'
  await fs.writeFile(path.join(dir, file), 'payload')
  const metadata = {
    version: '2.0.1',
    files: [{ url: file, size: 7, sha512: await digest(path.join(dir, file), 'sha512', 'base64') }]
  }
  await fs.writeFile(path.join(dir, 'latest.yml'), JSON.stringify(metadata))
  await expect(validateMetadata(dir, 'latest.yml', '2.0.1', [file])).resolves.toBeTruthy()
  await expect(
    validateMetadata(dir, 'latest.yml', '2.0.1', [file.replace('.exe', '-nomascot.exe')])
  ).rejects.toThrow()
  await fs.writeFile(path.join(dir, file), 'altered')
  await expect(validateMetadata(dir, 'latest.yml', '2.0.1', [file])).rejects.toThrow('integrity')
})
function fixtureClient() {
  const state = {
    id: 1,
    draft: true,
    body: 'marker',
    html_url: 'https://github.com/test/releases/tag/v2.0.1',
    assets: [] as Array<{ name: string; size: number; sha256: string }>
  }
  const client = {
    find: vi.fn(async () => null as unknown),
    create: vi.fn(async (_body: unknown) => state),
    get: vi.fn(async () => state),
    upload: vi.fn(async (_release: unknown, file: any) => {
      state.assets.push(file)
    }),
    hash: vi.fn(async (asset: any) => asset.sha256),
    publish: vi.fn(async () => {})
  }
  const plan = {
    version: '2.0.1',
    tag: 'v2.0.1',
    revision: 'revision',
    marker: 'marker',
    notes: 'notes',
    files: [{ name: 'installer', size: 7, sha256: 'digest' }]
  }
  return { state, client, plan }
}
it('publishes only after every remote byte is verified, and leaves failed uploads private', async () => {
  const { client, plan } = fixtureClient()
  await publishRelease(client, plan)
  expect(client.create.mock.calls[0][0]).toMatchObject({ draft: true })
  expect(client.publish).toHaveBeenCalledOnce()
  const failed = fixtureClient()
  failed.client.hash.mockResolvedValue('mismatch')
  await expect(publishRelease(failed.client, failed.plan)).rejects.toThrow('verification')
  expect(failed.client.publish).not.toHaveBeenCalled()
})
it('refuses existing public or unrelated drafts and resumes matching partial drafts without replacing files', async () => {
  for (const override of [{ draft: false }, { body: 'other run' }]) {
    const { client, state, plan } = fixtureClient()
    Object.assign(state, override)
    client.find.mockResolvedValue(state)
    await expect(publishRelease(client, plan)).rejects.toThrow('protected')
    expect(client.upload).not.toHaveBeenCalled()
  }
  const { client, state, plan } = fixtureClient()
  state.assets.push(plan.files[0])
  client.find.mockResolvedValue(state)
  await publishRelease(client, plan)
  expect(client.upload).not.toHaveBeenCalled()
  expect(client.publish).toHaveBeenCalledOnce()
})
it('rejects missing native platform evidence before producing a release candidate', async () => {
  const input = await directory(),
    output = await directory()
  await expect(collect(input, output, '2.0.1', 'revision')).rejects.toThrow()
  expect(await fs.readdir(output)).toEqual([])
})

it('collects only complete native variants and detects transport corruption before publication', async () => {
  const { platforms, variants } = await import('../../../scripts/release/policy.mjs')
  const { verifyCandidate } = await import('../../../scripts/release/verify-candidate.mjs')
  const input = await directory()
  const output = path.join(await directory(), 'candidate')
  for (const platform of platforms) {
    const target = path.join(input, `packages-${platform}`)
    await fs.mkdir(target)
    const report: any = {
      schemaVersion: 1,
      platform,
      version: '2.0.1',
      revision: 'source',
      sourceDigest: 'a'.repeat(64),
      sourceStable: true,
      channel: 'community',
      native: true,
      readiness: 'READY',
      variants: {}
    }
    for (const variant of variants) {
      const artifacts = []
      for (const file of assetNames('2.0.1', platform, variant)) {
        await fs.writeFile(path.join(target, file), `fixture ${platform} ${variant}`)
        artifacts.push({
          file,
          size: (await fs.stat(path.join(target, file))).size,
          sha256: await digest(path.join(target, file))
        })
      }
      report.variants[variant] = {
        build: 'PASS',
        integrity: 'PASS',
        runtime: 'PASS',
        installer: 'PASS',
        e2e: 'PASS',
        sessionRestart: 'PASS',
        tests: 7,
        updateMode: 'manual',
        artifacts
      }
    }
    await fs.writeFile(path.join(target, 'evidence.json'), JSON.stringify(report))
  }
  await collect(input, output, '2.0.1', 'source')
  await expect(verifyCandidate(output, '2.0.1', 'source')).resolves.toBeUndefined()
  expect(await fs.readdir(output)).not.toContain('latest-mac.yml')
  const installer = assetNames('2.0.1', 'darwin-arm64', 'standard')[0]
  await fs.writeFile(path.join(output, installer), 'corrupted transport')
  await expect(verifyCandidate(output, '2.0.1', 'source')).rejects.toThrow('integrity')
})

it('rejects publication before uploads if the tag is historical and leaves interrupted uploads in draft', async () => {
  const historical = fixtureClient()
  await expect(
    publishRelease(historical.client, { ...historical.plan, version: '2.0.0', tag: 'v2.0.0' })
  ).rejects.toThrow('protected')
  expect(historical.client.create).not.toHaveBeenCalled()
  const failure = fixtureClient()
  failure.client.upload.mockRejectedValue(new Error('Interrupted upload'))
  await expect(publishRelease(failure.client, failure.plan)).rejects.toThrow('Interrupted')
  expect(failure.client.publish).not.toHaveBeenCalled()
  expect(failure.state.draft).toBe(true)
})

// @vitest-environment node
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { generateKeyPairSync } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { parse } from 'yaml'
import {
  verifiedManifest,
  verifyManifestSignature,
  selectInstaller,
  verifyInstaller
} from './manifest.mjs'
import { signingFixture } from './signing-fixture'
import {
  privateKeyFromSecret,
  generateReleaseKey
} from '../../../../scripts/release/signing/keys.mjs'
import { signCandidate } from '../../../../scripts/release/signing/sign.mjs'
import { verifyCandidate } from '../../../../scripts/release/verify-candidate.mjs'
import { publishRelease } from '../../../../scripts/release/publish.mjs'

const temporary: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  for (const directory of temporary.splice(0))
    await fs.rm(directory, { recursive: true, force: true })
})
async function directory() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'release-signing-'))
  temporary.push(dir)
  return dir
}

it('signs and verifies the exact original bytes with native Ed25519', () => {
  const f = signingFixture()
  expect(verifyManifestSignature(f.bytes, f.signature, f.trust)).toBe(f.keyId)
  expect(verifiedManifest(f.bytes, f.signature, f.trust, '2.0.1')).toEqual(f.manifest)
  expect(() =>
    verifyManifestSignature(Buffer.from(f.bytes.toString().trim()), f.signature, f.trust)
  ).toThrow('signature')
  expect(() => verifyManifestSignature(Buffer.from('{broken'), f.signature, f.trust)).toThrow(
    'signature'
  )
})
it('rejects wrong keys, unknown IDs, revoked keys and algorithm substitution', () => {
  const f = signingFixture(),
    other = signingFixture()
  expect(() => verifyManifestSignature(f.bytes, f.signature, other.trust)).toThrow()
  expect(() =>
    verifyManifestSignature(f.bytes, f.signature, { schemaVersion: 1, keys: [] })
  ).toThrow('Unknown')
  f.trust.keys[0].revoked = true
  expect(() => verifyManifestSignature(f.bytes, f.signature, f.trust)).toThrow('revoked')
  f.trust.keys[0].revoked = false
  for (const patch of [
    { algorithm: 'SHA256' },
    { signature: 'a'.repeat(64) },
    { extra: true },
    { keyId: '../key' }
  ]) {
    const envelope = Buffer.from(
      JSON.stringify({ ...JSON.parse(f.signature.toString()), ...patch })
    )
    expect(() => verifyManifestSignature(f.bytes, envelope, f.trust)).toThrow()
  }
})
it('supports staged key rotation and refuses the retired key after revocation', () => {
  const old = signingFixture(),
    next = signingFixture()
  next.trust.keys[0].keyId = 'next-key'
  const signature = JSON.parse(next.signature.toString())
  signature.keyId = 'next-key'
  const trust = { schemaVersion: 1, keys: [...old.trust.keys, ...next.trust.keys] }
  expect(verifyManifestSignature(old.bytes, old.signature, trust)).toBe(old.keyId)
  expect(verifyManifestSignature(next.bytes, Buffer.from(JSON.stringify(signature)), trust)).toBe(
    'next-key'
  )
  trust.keys[0].revoked = true
  expect(() => verifyManifestSignature(old.bytes, old.signature, trust)).toThrow('revoked')
  expect(() => verifyManifestSignature(next.bytes, next.signature, old.trust)).toThrow()
})
it.each([
  'platform',
  'arch',
  'variant',
  'file',
  'version',
  'size',
  'sha256',
  'missing',
  'duplicate'
])('rejects a correctly signed manifest with invalid %s', (field) => {
  const f = signingFixture()
  if (field === 'version') f.manifest.version = '9.0.0'
  else if (field === 'missing') f.manifest.artifacts.pop()
  else if (field === 'duplicate') f.manifest.artifacts[1] = f.manifest.artifacts[0]
  else
    Object.assign(f.manifest.artifacts[0], {
      [field]: field === 'file' ? '../installer.dmg' : field === 'size' ? -1 : 'invalid'
    })
  const bytes = f.encode()
  expect(() => verifiedManifest(bytes, f.seal(bytes), f.trust, '2.0.1')).toThrow()
})
it('selects both variants and exact architectures; refuses unsupported or missing packages', () => {
  const f = signingFixture()
  expect(selectInstaller(f.manifest, 'darwin', 'x64', 'nomascot').file).toBe(
    'Pi-Harness-2.0.1-x64-nomascot.dmg'
  )
  expect(selectInstaller(f.manifest, 'win32', 'x64', 'standard').file).toBe(
    'Pi-Harness-Setup-2.0.1.exe'
  )
  expect(() => selectInstaller(f.manifest, 'win32', 'arm64', 'standard')).toThrow()
  expect(() => selectInstaller(f.manifest, 'darwin', 'arm64', 'other')).toThrow()
  f.manifest.artifacts = []
  expect(() => selectInstaller(f.manifest, 'linux', 'x64', 'standard')).toThrow()
})
it('recomputes real installer size/SHA256 and refuses missing files and symlinks', async () => {
  const f = signingFixture(),
    dir = await directory(),
    file = path.join(dir, 'payload')
  const item = f.manifest.artifacts[0]
  await expect(verifyInstaller(file, item)).rejects.toThrow()
  await fs.writeFile(file, f.payload)
  await expect(verifyInstaller(file, item)).resolves.toBeUndefined()
  await fs.writeFile(file, Buffer.alloc(f.payload.length, 1))
  await expect(verifyInstaller(file, item)).rejects.toThrow('SHA-256')
  await fs.writeFile(file, 'truncated')
  await expect(verifyInstaller(file, item)).rejects.toThrow('size')
  if (process.platform !== 'win32') {
    await fs.symlink(file, file + '-link')
    await expect(verifyInstaller(file + '-link', item)).rejects.toThrow()
  }
})
it('accepts PEM/Base64 secrets and rejects absent, malformed and non-Ed25519 secrets without echoing them', () => {
  const f = signingFixture(),
    pem = f.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  for (const secret of [pem, Buffer.from(pem).toString('base64')])
    expect(privateKeyFromSecret(secret).equals(f.privateKey)).toBe(true)
  for (const secret of [
    undefined,
    '',
    'sensitive-invalid-private-value',
    generateKeyPairSync('ed448').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  ]) {
    expect(() => privateKeyFromSecret(secret)).toThrow()
    try {
      privateKeyFromSecret(secret)
    } catch (error) {
      expect((error as Error).message).not.toContain('sensitive-invalid-private-value')
    }
  }
})
it('generates protected PEM locally, refuses overwrite and refuses CI key generation', async () => {
  vi.stubEnv('CI', '')
  vi.stubEnv('GITHUB_ACTIONS', '')
  const dir = await directory()
  const entry = await generateReleaseKey(dir, 'local-test')
  expect(entry.publicKey).toContain('BEGIN PUBLIC KEY')
  if (process.platform !== 'win32')
    expect((await fs.stat(path.join(dir, 'local-test.private.pem'))).mode & 0o777).toBe(0o600)
  await expect(generateReleaseKey(dir, 'local-test')).rejects.toThrow()
  vi.stubEnv('CI', 'true')
  await expect(generateReleaseKey(dir, 'other')).rejects.toThrow('locally')
})
it('signs complete candidates without modifying the manifest; official verification refuses unsigned previews', async () => {
  const f = signingFixture(),
    dir = await directory()
  await fs.writeFile(path.join(dir, 'checksums.json'), f.bytes)
  for (const item of f.manifest.artifacts) await fs.writeFile(path.join(dir, item.file), f.payload)
  await fs.writeFile(
    path.join(dir, 'SHA256SUMS'),
    f.manifest.artifacts.map((item) => `${item.sha256}  ${item.file}\n`).join('')
  )
  await expect(
    verifyCandidate(dir, '2.0.1', 'revision', { requireSignature: true, trust: f.trust })
  ).rejects.toThrow('signature')
  await expect(signCandidate(dir, f.keyId, undefined, f.trust)).rejects.toThrow('required')
  await expect(
    signCandidate(
      dir,
      f.keyId,
      signingFixture().privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      f.trust
    )
  ).rejects.toThrow('match')
  await signCandidate(
    dir,
    f.keyId,
    f.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    f.trust
  )
  expect(await fs.readFile(path.join(dir, 'checksums.json'))).toEqual(f.bytes)
  await expect(
    verifyCandidate(dir, '2.0.1', 'revision', { requireSignature: true, trust: f.trust })
  ).resolves.toBeUndefined()
  await fs.writeFile(path.join(dir, f.manifest.artifacts[0].file), 'damaged')
  await expect(
    verifyCandidate(dir, '2.0.1', 'revision', { requireSignature: true, trust: f.trust })
  ).rejects.toThrow('integrity')
})
it('refuses unsigned publication before making any API calls', async () => {
  const client = { find: vi.fn() }
  await expect(publishRelease(client, { version: '2.0.1', tag: 'v2.0.1' })).rejects.toThrow()
  expect(client.find).not.toHaveBeenCalled()
})
it('keeps PR/fork CI secret-free and isolates the official tag-only signing step', async () => {
  const ciText = await fs.readFile('.github/workflows/ci.yml', 'utf8')
  const releaseText = await fs.readFile('.github/workflows/release.yml', 'utf8')
  expect(ciText).not.toContain('secrets.')
  const workflow = parse(releaseText)
  expect(Object.keys(workflow.jobs)).toEqual(['validate', 'quality', 'collect', 'publish'])
  const signing = workflow.jobs.collect.steps.filter(
    (step: any) => step.env?.PI_HARNESS_RELEASE_SIGNING_KEY
  )
  expect(signing).toHaveLength(1)
  expect(signing[0].if).toContain("github.event_name == 'push'")
  expect(signing[0].if).toContain("github.ref_type == 'tag'")
  expect(signing[0].if).toContain("github.repository == 'wangmiaozero/pi-harness'")
  expect(signing[0].continueOnError).toBeUndefined()
  expect(workflow.jobs.publish.permissions).toEqual({ contents: 'write' })
  expect(workflow.permissions).toEqual({ contents: 'read' })
  expect(workflow.jobs.quality.secrets).toBeUndefined()
  const policy = JSON.parse(await fs.readFile('resources/release-policy.json', 'utf8'))
  expect(policy).toEqual({ channel: 'community', updateMode: 'manual' })
  const builder = parse(await fs.readFile('electron-builder.yml', 'utf8'))
  expect(builder.mac.identity).toBe('-')
  expect(builder.mac.notarize).toBe(false)
  const afterSign = await fs.readFile('scripts/release/after-sign.mjs', 'utf8')
  expect(afterSign).toContain("['--verify', '--deep', '--strict', '--verbose=2', app]")
})

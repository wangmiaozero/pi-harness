// Shared by the release tools and bundled Main process. No private-key code here.
import { createPublicKey, verify, createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'

export const releasePlatforms = ['darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-x64']
export const releaseVariants = ['standard', 'nomascot']
export const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
export const keyIdentifier = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/

export function assetNames(version, platform, variant) {
  const [os, arch] = platform.split('-')
  const suffix = variant === 'nomascot' ? '-nomascot' : ''
  if (os === 'darwin')
    return [
      `Pi-Harness-${version}${arch === 'arm64' || variant === 'nomascot' ? `-${arch}` : ''}${suffix}.dmg`,
      `Pi-Harness-${version}${arch === 'arm64' || variant === 'nomascot' ? `-${arch}` : ''}${suffix}${variant === 'standard' ? '-mac' : ''}.zip`
    ]
  if (os === 'win32')
    return [`Pi-Harness-Setup-${version}${arch === 'arm64' ? '-arm64' : ''}${suffix}.exe`]
  return [
    `Pi-Harness-${version}${arch === 'arm64' || variant === 'nomascot' ? `-${arch === 'x64' ? 'x86_64' : arch}` : ''}${suffix}.AppImage`
  ]
}

export function trustedPublicKey(trust, keyId) {
  if (
    trust?.schemaVersion !== 1 ||
    !Array.isArray(trust.keys) ||
    typeof keyId !== 'string' ||
    !keyIdentifier.test(keyId)
  )
    throw new Error('Invalid release trust store or key ID')
  const matches = trust.keys.filter((key) => key.keyId === keyId)
  if (matches.length !== 1 || matches[0].revoked !== false)
    throw new Error('Unknown or revoked release signing key')
  const pem = matches[0].publicKey
  if (typeof pem !== 'string' || !pem.startsWith('-----BEGIN PUBLIC KEY-----'))
    throw new Error('Release trust store must contain public PEM keys only')
  const key = createPublicKey(pem)
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Release key must be Ed25519')
  return key
}

export function verifyManifestSignature(bytes, signatureBytes, trust) {
  if (bytes.length > 1024 * 1024 || signatureBytes.length > 4096)
    throw new Error('Release signature or manifest exceeds size limit')
  const envelope = JSON.parse(signatureBytes.toString('utf8'))
  if (
    envelope.schemaVersion !== 1 ||
    envelope.algorithm !== 'Ed25519' ||
    typeof envelope.signature !== 'string' ||
    Object.keys(envelope).sort().join(',') !== 'algorithm,keyId,schemaVersion,signature'
  )
    throw new Error('Invalid release signature format')
  const signature = Buffer.from(envelope.signature, 'base64')
  if (signature.length !== 64 || signature.toString('base64') !== envelope.signature)
    throw new Error('Invalid Ed25519 signature encoding')
  if (!verify(null, bytes, trustedPublicKey(trust, envelope.keyId), signature))
    throw new Error('Release signature verification failed')
  return envelope.keyId
}

// Only call on authenticated bytes in a trusted-update or publication path.
export function parseManifest(bytes, version, revision) {
  if (!stableVersion.test(version) || bytes.length > 1024 * 1024)
    throw new Error('Invalid release version or manifest size')
  const manifest = JSON.parse(bytes.toString('utf8'))
  if (
    manifest.version !== version ||
    manifest.channel !== 'community' ||
    typeof manifest.revision !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(manifest.revision) ||
    (revision !== undefined && manifest.revision !== revision)
  )
    throw new Error('Candidate version/source/policy mismatch')
  if (
    manifest.releaseNotes !== undefined &&
    (typeof manifest.releaseNotes !== 'string' || manifest.releaseNotes.length > 65536)
  )
    throw new Error('Invalid signed release notes')
  const previews = manifest.previewPlatforms ?? []
  if (
    !Array.isArray(previews) ||
    new Set(previews).size !== previews.length ||
    previews.some((target) => !['win32-arm64', 'linux-arm64'].includes(target))
  )
    throw new Error('Invalid signed preview platforms')
  const expected = [...releasePlatforms, ...previews].flatMap((platform) =>
    releaseVariants.flatMap((variant) =>
      assetNames(version, platform, variant).map((file) => ({
        file,
        platform: platform.split('-')[0],
        arch: platform.split('-')[1],
        variant
      }))
    )
  )
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length !== expected.length)
    throw new Error('Incomplete installer checksum manifest')
  const seen = new Set()
  for (const item of manifest.artifacts) {
    const contract = expected.find((entry) => entry.file === item?.file)
    if (
      !contract ||
      seen.has(item.file) ||
      item.platform !== contract.platform ||
      item.arch !== contract.arch ||
      item.variant !== contract.variant ||
      !Number.isSafeInteger(item.size) ||
      item.size <= 0 ||
      item.size > 16 * 1024 ** 3 ||
      typeof item.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(item.sha256)
    )
      throw new Error('Invalid installer filename/platform/architecture/variant/size/hash')
    seen.add(item.file)
  }
  return manifest
}

export function verifiedManifest(bytes, signatureBytes, trust, version, revision) {
  verifyManifestSignature(bytes, signatureBytes, trust)
  return parseManifest(bytes, version, revision)
}

export function selectInstaller(manifest, platform, arch, variant) {
  if (
    ![...releasePlatforms, ...(manifest.previewPlatforms ?? [])].includes(`${platform}-${arch}`) ||
    !releaseVariants.includes(variant)
  )
    throw new Error('No signed installer for this platform/architecture/variant')
  const extension = platform === 'darwin' ? '.dmg' : platform === 'win32' ? '.exe' : '.AppImage'
  const matches = manifest.artifacts.filter(
    (item) =>
      item.platform === platform &&
      item.arch === arch &&
      item.variant === variant &&
      item.file.endsWith(extension)
  )
  if (matches.length !== 1) throw new Error('Signed installer is missing or ambiguous')
  return matches[0]
}

export async function verifyInstaller(file, item) {
  const stat = await fs.lstat(file)
  if (!stat.isFile() || stat.size !== item.size) throw new Error('Installer size/type mismatch')
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  if (hash.digest('hex') !== item.sha256) throw new Error('Installer SHA-256 integrity mismatch')
}

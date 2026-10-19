import fs from 'node:fs/promises'
import path from 'node:path'
import { assetNames, digest, platforms, variants } from './policy.mjs'
import { parseManifest, verifiedManifest } from '../../src/main/updater/security/manifest.mjs'
export async function verifyCandidate(
  directory,
  version,
  revision,
  { requireSignature = false, trust } = {}
) {
  for (const name of await fs.readdir(directory)) {
    if (!(await fs.lstat(path.join(directory, name))).isFile())
      throw new Error('Candidate assets must be regular files, never symlinks or directories')
  }
  const bytes = await fs.readFile(path.join(directory, 'checksums.json'))
  const signature = await fs.readFile(path.join(directory, 'checksums.json.sig')).catch((error) => {
    if (error.code !== 'ENOENT') throw error
    return null
  })
  if (requireSignature && !signature) throw new Error('Required release signature is missing')
  if (signature && !trust)
    trust = JSON.parse(
      await fs.readFile(
        new URL('../../resources/release-public-keys.json', import.meta.url),
        'utf8'
      )
    )
  const manifest = signature
    ? verifiedManifest(bytes, signature, trust, version, revision)
    : parseManifest(bytes, version, revision)
  const expected = platforms.flatMap((platform) =>
    variants.flatMap((variant) => assetNames(version, platform, variant))
  )
  if (manifest.artifacts?.length !== expected.length)
    throw new Error('Incomplete installer checksum manifest')
  for (const name of expected) {
    const item = manifest.artifacts.find((item) => item.file === name)
    const target = path.join(directory, name)
    if (
      !item ||
      (await fs.lstat(target)).size !== item.size ||
      (await digest(target)) !== item.sha256
    )
      throw new Error(`Candidate integrity mismatch: ${name}`)
  }
  const sums = new Map()
  for (const line of (await fs.readFile(path.join(directory, 'SHA256SUMS'), 'utf8'))
    .trim()
    .split('\n')) {
    const match = line.match(/^([a-f0-9]{64}) {2}([A-Za-z0-9._-]+)$/)
    if (!match || sums.has(match[2])) throw new Error('Invalid checksum inventory')
    sums.set(match[2], match[1])
  }
  const allowed = new Set([...expected, ...expected.map((name) => `${name}.blockmap`)])
  for (const name of await fs.readdir(directory)) {
    if (['checksums.json', 'checksums.json.sig', 'SHA256SUMS'].includes(name)) continue
    if (
      !(await fs.lstat(path.join(directory, name))).isFile() ||
      !allowed.has(name) ||
      sums.get(name) !== (await digest(path.join(directory, name)))
    )
      throw new Error(`Unexpected or corrupt candidate asset: ${name}`)
    sums.delete(name)
  }
  if (sums.size) throw new Error('Checksum list references missing assets')
}

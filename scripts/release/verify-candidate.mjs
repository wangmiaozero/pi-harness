import fs from 'node:fs/promises'
import path from 'node:path'
import { assetNames, digest, platforms, variants } from './policy.mjs'
export async function verifyCandidate(directory, version, revision) {
  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'checksums.json'), 'utf8'))
  if (
    manifest.version !== version ||
    manifest.revision !== revision ||
    manifest.channel !== 'community'
  )
    throw new Error('Candidate version/source/policy mismatch')
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
      (await fs.stat(target)).size !== item.size ||
      (await digest(target)) !== item.sha256
    )
      throw new Error(`Candidate integrity mismatch: ${name}`)
  }
  const sums = new Map()
  for (const line of (await fs.readFile(path.join(directory, 'SHA256SUMS'), 'utf8'))
    .trim()
    .split('\n')) {
    const match = line.match(/^([a-f0-9]{64})  ([A-Za-z0-9._-]+)$/)
    if (!match || sums.has(match[2])) throw new Error('Invalid checksum inventory')
    sums.set(match[2], match[1])
  }
  const allowed = new Set([...expected, ...expected.map((name) => `${name}.blockmap`)])
  for (const name of await fs.readdir(directory)) {
    if (['checksums.json', 'SHA256SUMS'].includes(name)) continue
    if (!allowed.has(name) || sums.get(name) !== (await digest(path.join(directory, name))))
      throw new Error(`Unexpected or corrupt candidate asset: ${name}`)
    sums.delete(name)
  }
  if (sums.size) throw new Error('Checksum list references missing assets')
}

import fs from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import semver from 'semver'
import {
  catalog,
  sha256,
  inventory,
  treeDigest,
  extractRuntimeArchive,
  runtimeLayout
} from '../../src/main/runtime/distribution.mjs'
import { binaryIdentity } from '../../src/main/runtime/binary-identity.mjs'
import { macosContentHash } from '../../src/main/runtime/macos-content.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const version = process.argv.find((value) => value.startsWith('--pi-version='))?.slice(13)
if (!version || !semver.valid(version) || semver.prerelease(version))
  throw new Error('Choose an explicit stable version with --pi-version=X.Y.Z')
const cache = path.resolve(
  process.env.PI_HARNESS_RUNTIME_CACHE ?? path.join(root, '.runtime-cache')
)
await fs.mkdir(cache, { recursive: true })
async function json(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`Official metadata request failed: ${response.status}`)
  return response.json()
}
async function download(url, destination, expected) {
  if (expected && (await sha256(destination).catch(() => null)) === expected) return
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) })
  if (!response.ok || !response.body)
    throw new Error(`Official download failed: ${response.status}`)
  const temporary = `${destination}.${process.pid}.part`
  try {
    await pipeline(
      Readable.fromWeb(response.body),
      createWriteStream(temporary, { flags: 'wx', mode: 0o600 })
    )
    if (expected && (await sha256(temporary)) !== expected)
      throw new Error('Official asset SHA256 mismatch')
    await fs.rename(temporary, destination)
  } finally {
    await fs.rm(temporary, { force: true })
  }
}
const release = await json(
  `https://api.github.com/repos/earendil-works/pi/releases/tags/v${version}`
)
if (release.draft || release.prerelease || release.tag_name !== `v${version}`)
  throw new Error('The requested release is not a published stable release')
const candidate = structuredClone(catalog)
candidate.pi.version = version
candidate.pi.baseUrl = `https://github.com/earendil-works/pi/releases/download/v${version}/`
const sumsAsset = release.assets.find((asset) => asset.name === 'SHA256SUMS')
if (!/^sha256:[a-f0-9]{64}$/.test(sumsAsset?.digest ?? ''))
  throw new Error('Official checksum asset digest is unavailable')
candidate.pi.checksumsSha256 = sumsAsset.digest.slice(7)
const sumsFile = path.join(cache, `pi-${version}-SHA256SUMS`)
await download(candidate.pi.baseUrl + 'SHA256SUMS', sumsFile, candidate.pi.checksumsSha256)
const sums = new Map(
  (await fs.readFile(sumsFile, 'utf8'))
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const [hash, file] = line.trim().split(/\s+/)
      if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid official checksum')
      return [file.replace(/^\*/, ''), hash]
    })
)
const notice = candidate.pi.notices.LICENSE
notice.url = `https://raw.githubusercontent.com/earendil-works/pi/v${version}/LICENSE`
const licenseFile = path.join(cache, `pi-${version}-LICENSE`)
await download(notice.url, licenseFile)
notice.sha256 = await sha256(licenseFile)
for (const [target, previous] of Object.entries(candidate.pi.assets)) {
  const [platform, arch] = target.split('-')
  const asset = release.assets.find((asset) => asset.name === previous.file)
  const expected = sums.get(previous.file)
  if (!asset || !expected || asset.digest !== `sha256:${expected}`)
    throw new Error(`Missing or inconsistent official asset: ${target}`)
  const archive = path.join(cache, previous.file)
  await download(candidate.pi.baseUrl + previous.file, archive, expected)
  const temporary = await fs.mkdtemp(path.join(cache, 'catalog-review-'))
  try {
    await extractRuntimeArchive(archive, temporary)
    const entries = await fs.readdir(temporary, { withFileTypes: true })
    const extracted =
      entries.length === 1 && entries[0].isDirectory()
        ? path.join(temporary, entries[0].name)
        : temporary
    await fs.copyFile(licenseFile, path.join(extracted, 'LICENSE'))
    const executable = path.join(extracted, runtimeLayout('pi', platform).executable)
    const identity = await binaryIdentity(executable)
    if (identity?.platform !== platform || identity.arch !== arch)
      throw new Error(`Invalid binary architecture: ${target}`)
    const files = await inventory(extracted)
    const result = { file: previous.file, sha256: expected, treeSha256: treeDigest(files) }
    if (platform === 'darwin') {
      if (process.platform !== 'darwin')
        throw new Error('A macOS host is required to review canonical signed contents')
      result.signedFileContentSha256 = {}
      for (const file of Object.keys(files)) {
        if ((await binaryIdentity(path.join(extracted, file)))?.platform === 'darwin')
          result.signedFileContentSha256[file] = await macosContentHash(path.join(extracted, file))
      }
    }
    candidate.pi.assets[target] = result
    process.stderr.write(`${target}: archive, tree, license and binary architecture verified\n`)
  } finally {
    await fs.rm(temporary, { recursive: true, force: true })
  }
}
if (process.argv.includes('--write')) {
  const destination = path.join(root, 'src/main/runtime/catalog.json')
  const temporary = `${destination}.${process.pid}.tmp`
  await fs.writeFile(temporary, JSON.stringify(candidate, null, 2) + '\n')
  await fs.rename(temporary, destination)
}
process.stdout.write(JSON.stringify(candidate, null, 2) + '\n')

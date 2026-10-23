import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import semver from 'semver'
import { assessNodeSecurity } from '../../src/shared/runtime/node-security-policy.mjs'
import {
  catalog,
  sha256,
  inventory,
  treeDigest,
  extractRuntimeArchive,
  runtimeLayout
} from '../../src/main/runtime/distribution.mjs'
import { binaryIdentity } from '../../src/main/runtime/binary-identity.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const requested = process.argv.find((arg) => arg.startsWith('--node-version='))?.slice(15)
if (
  !requested ||
  !semver.valid(requested) ||
  semver.prerelease(requested) ||
  semver.major(requested) !== 24
)
  throw new Error('Choose a stable Node 24 release with --node-version=X.Y.Z')
if (!assessNodeSecurity(requested).executionAllowed)
  throw new Error('Requested Node release does not meet the security policy')
const cache = path.resolve(
  process.env.PI_HARNESS_RUNTIME_CACHE ?? path.join(root, '.runtime-cache')
)
await fs.mkdir(cache, { recursive: true })
async function official(url) {
  if (process.argv.includes('--curl')) {
    const { stdout } = await promisify(execFile)(
      'curl',
      [
        '--fail',
        '--silent',
        '--show-error',
        '--retry',
        '3',
        '--connect-timeout',
        '20',
        '--max-time',
        '300',
        '--proto',
        '=https',
        url
      ],
      { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 }
    ).catch((error) => {
      throw new Error(`Official download failed (${error.code}): ${url}`)
    })
    return new Response(stdout)
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000), redirect: 'error' })
  if (!response.ok) throw new Error(`Official Node download failed: ${response.status}`)
  return response
}
const releases = await (await official('https://nodejs.org/dist/index.json')).json()
const release = releases.find((entry) => entry.version === `v${requested}` && entry.lts)
if (!release) throw new Error('Requested version is not an official LTS release')
const candidate = structuredClone(catalog)
const baseUrl = `https://nodejs.org/dist/v${requested}/`
const sumsFile = path.join(cache, `node-${requested}-SHASUMS256.txt`)
await fs.writeFile(sumsFile, await (await official(baseUrl + 'SHASUMS256.txt')).text())
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
candidate.node.version = requested
candidate.node.baseUrl = baseUrl
candidate.node.checksumsSha256 = await sha256(sumsFile)
for (const target of Object.keys(candidate.node.assets)) {
  const [platform, arch] = target.split('-')
  const file = `node-v${requested}-${platform === 'win32' ? 'win' : platform}-${arch}.${platform === 'win32' ? 'zip' : 'tar.gz'}`
  const expected = sums.get(file)
  if (!expected) throw new Error(`Missing official asset: ${file}`)
  const archive = path.join(cache, file)
  if ((await sha256(archive).catch(() => null)) !== expected) {
    const temporary = `${archive}.${process.pid}.part`
    try {
      const response = await official(baseUrl + file)
      await pipeline(
        Readable.fromWeb(response.body),
        createWriteStream(temporary, { flags: 'wx', mode: 0o600 })
      )
      if ((await sha256(temporary)) !== expected)
        throw new Error(`Archive checksum mismatch: ${file}`)
      await fs.rename(temporary, archive)
    } finally {
      await fs.rm(temporary, { force: true })
    }
  }
  const temporary = await fs.mkdtemp(path.join(cache, 'node-catalog-'))
  try {
    await extractRuntimeArchive(archive, temporary)
    const entries = await fs.readdir(temporary, { withFileTypes: true })
    if (entries.length !== 1 || !entries[0].isDirectory())
      throw new Error('Unexpected Node archive layout')
    const extracted = path.join(temporary, entries[0].name)
    const layout = runtimeLayout('node', platform)
    const identity = await binaryIdentity(path.join(extracted, layout.executable))
    if (identity?.platform !== platform || identity.arch !== arch)
      throw new Error(`Architecture mismatch: ${target}`)
    const npm = JSON.parse(
      await fs.readFile(path.resolve(extracted, layout.npm, '../../package.json'), 'utf8')
    )
    if (npm.version !== release.npm) throw new Error(`npm version mismatch: ${target}`)
    candidate.node.npmVersion = npm.version
    candidate.node.assets[target] = {
      file,
      sha256: expected,
      treeSha256: treeDigest(await inventory(extracted))
    }
    process.stderr.write(`${target}: official archive, architecture, npm and file tree verified\n`)
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
process.stdout.write(JSON.stringify(candidate.node, null, 2) + '\n')

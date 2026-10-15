import { binaryIdentity } from './binary-identity.mjs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import * as tar from 'tar'
import unzipper from 'unzipper'
import catalog from './catalog.json' with { type: 'json' }

export { catalog }
export async function sha256(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

export function assertArchivePath(name, link, type) {
  const value = name.replaceAll('\\', '/')
  if (
    !value ||
    value.includes('\0') ||
    /^[a-z]:|^\//i.test(value) ||
    value.split('/').includes('..')
  ) {
    throw new Error('Unsafe runtime archive path')
  }
  if (link) {
    const target = link.replaceAll('\\', '/')
    const resolved = path.posix.normalize(
      path.posix.join(type === 'Link' ? '' : path.posix.dirname(value), target)
    )
    if (/^[a-z]:|^\//i.test(target) || resolved === '..' || resolved.startsWith('../')) {
      throw new Error('Unsafe runtime archive link')
    }
  }
}

async function download(url, destination, expected, offline, signal, fetcher = fetch) {
  if ((await sha256(destination).catch(() => null)) === expected) return
  if (offline) throw new Error(`Verified offline cache missing: ${path.basename(destination)}`)
  const response = await fetcher(url, {
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(180_000)])
      : AbortSignal.timeout(180_000)
  })
  if (!response.ok || !response.body)
    throw new Error(`Runtime download failed: HTTP ${response.status}`)
  const temporary = `${destination}.${randomUUID()}.part`
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary, { mode: 0o600 }), {
      signal
    })
    if ((await sha256(temporary)) !== expected) throw new Error('Runtime download SHA256 mismatch')
    await fs.rename(temporary, destination)
  } finally {
    await fs.rm(temporary, { force: true })
  }
}

export function treeDigest(files) {
  const entries = Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return createHash('sha256').update(JSON.stringify(entries)).digest('hex')
}

export async function inventory(root) {
  const files = {}
  const canonicalRoot = await fs.realpath(root)
  async function walk(dir) {
    for (const entry of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      if (dir === root && entry.name === 'runtime-receipt.json') continue
      const file = path.join(dir, entry.name)
      const relative = path.relative(root, file).split(path.sep).join('/')
      if (entry.isSymbolicLink()) {
        const real = await fs.realpath(file)
        const inside = path.relative(canonicalRoot, real)
        if (inside === '..' || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside))
          throw new Error('Runtime symlink escapes distribution')
        files[relative] = `link:${await fs.readlink(file)}`
      } else if (entry.isDirectory()) await walk(file)
      else if (entry.isFile()) files[relative] = await sha256(file)
      else throw new Error('Unsupported runtime file type')
    }
  }
  await walk(root)
  return files
}

export function runtimeLayout(kind, platform) {
  const windows = platform === 'win32'
  return kind === 'pi'
    ? { executable: windows ? 'pi.exe' : 'pi' }
    : {
        executable: windows ? 'node.exe' : 'bin/node',
        npm: windows ? 'node_modules/npm/bin/npm-cli.js' : 'lib/node_modules/npm/bin/npm-cli.js',
        npx: windows ? 'node_modules/npm/bin/npx-cli.js' : 'lib/node_modules/npm/bin/npx-cli.js'
      }
}

export async function verifyDistribution(root, kind, platform, arch) {
  const release = catalog[kind]
  const asset = release?.assets[`${platform}-${arch}`]
  if (!asset) throw new Error('Unsupported runtime platform')
  const receipt = JSON.parse(await fs.readFile(path.join(root, 'runtime-receipt.json'), 'utf8'))
  if (
    receipt.kind !== kind ||
    receipt.version !== release.version ||
    receipt.platform !== platform ||
    receipt.arch !== arch ||
    receipt.archiveSha256 !== asset.sha256
  ) {
    throw new Error('Runtime provenance does not match the pinned catalog')
  }
  const actual = await inventory(root)
  if (treeDigest(actual) !== treeDigest(receipt.files) || treeDigest(actual) !== asset.treeSha256)
    throw new Error('Runtime integrity check failed')
  const layout = runtimeLayout(kind, platform)
  for (const [name, notice] of Object.entries(release.notices ?? {})) {
    if (actual[name] !== notice.sha256)
      throw new Error('Runtime license notice is missing or invalid')
  }
  for (const file of Object.values(layout)) {
    if (!actual[file]) throw new Error(`Runtime entry is missing: ${file}`)
  }
  const identity = await binaryIdentity(path.join(root, layout.executable))
  if (!identity || identity.platform !== platform || identity.arch !== arch)
    throw new Error('Runtime executable platform or CPU mismatch')
  return receipt
}

export async function acquireDistribution({
  kind,
  platform,
  arch,
  destination,
  cache,
  offline = false,
  signal,
  fetcher = fetch,
  onProgress
}) {
  signal?.throwIfAborted()
  const release = catalog[kind]
  const asset = release?.assets[`${platform}-${arch}`]
  if (!asset) throw new Error(`No official ${kind} asset for ${platform}-${arch}`)
  onProgress?.('verifying-source', 12)
  await fs.mkdir(cache, { recursive: true, mode: 0o700 })
  const checksum = path.join(cache, `${kind}-${release.version}-${release.checksumsFile}`)
  await download(
    release.baseUrl + release.checksumsFile,
    checksum,
    release.checksumsSha256,
    offline,
    signal,
    fetcher
  )
  const sums = await fs.readFile(checksum, 'utf8')
  if (
    !sums
      .split(/\r?\n/)
      .some((line) => line.trim().split(/\s+/).join(' ') === `${asset.sha256} ${asset.file}`)
  ) {
    throw new Error('Official checksums do not match the pinned runtime catalog')
  }
  const archive = path.join(cache, asset.file)
  onProgress?.('acquiring-runtime', 25)
  await download(release.baseUrl + asset.file, archive, asset.sha256, offline, signal, fetcher)
  onProgress?.('extracting-runtime', 65)
  const staging = `${destination}.${randomUUID()}.staging`
  await fs.mkdir(staging, { recursive: true, mode: 0o700 })
  try {
    if (asset.file.endsWith('.zip')) {
      const zip = await unzipper.Open.file(archive)
      let totalSize = 0
      // Validate the complete directory before writing a single archive entry.
      for (const entry of zip.files) {
        assertArchivePath(entry.path)
        const mode = (entry.externalFileAttributes >>> 16) & 0o170000
        if (mode && mode !== 0o100000 && mode !== 0o040000)
          throw new Error('Runtime ZIP links and special files are not supported')
        totalSize += entry.uncompressedSize
        if (totalSize > 2 * 1024 * 1024 * 1024)
          throw new Error('Runtime archive exceeds the extraction limit')
      }
      for (const entry of zip.files) {
        signal?.throwIfAborted()
        const target = path.join(staging, entry.path)
        if (entry.type === 'Directory') await fs.mkdir(target, { recursive: true })
        else {
          await fs.mkdir(path.dirname(target), { recursive: true })
          await pipeline(entry.stream(), createWriteStream(target, { flags: 'wx', mode: 0o644 }), {
            signal
          })
        }
      }
    } else {
      let invalidEntry
      let totalSize = 0
      await tar.t({
        file: archive,
        onReadEntry: (entry) => {
          try {
            assertArchivePath(entry.path, entry.linkpath, entry.type)
            totalSize += entry.size ?? 0
            if (totalSize > 2 * 1024 * 1024 * 1024)
              throw new Error('Runtime archive exceeds the extraction limit')
            if (
              ![
                'File',
                'Directory',
                'SymbolicLink',
                'Link',
                'ExtendedHeader',
                'GlobalExtendedHeader'
              ].includes(entry.type)
            )
              throw new Error('Unsupported archive entry')
          } catch (error) {
            invalidEntry ??= error
          }
        }
      })
      if (invalidEntry) throw invalidEntry
      signal?.throwIfAborted()
      await tar.x({ file: archive, cwd: staging, strict: true, preserveOwner: false })
    }
    const entries = await fs.readdir(staging, { withFileTypes: true })
    const extracted =
      entries.length === 1 && entries[0].isDirectory()
        ? path.join(staging, entries[0].name)
        : staging
    const layout = runtimeLayout(kind, platform)
    await fs.access(path.join(extracted, layout.executable))
    if (platform !== 'win32') await fs.chmod(path.join(extracted, layout.executable), 0o755)
    for (const [name, notice] of Object.entries(release.notices ?? {})) {
      const noticeCache = path.join(cache, `${kind}-${release.version}-${name}`)
      await download(notice.url, noticeCache, notice.sha256, offline, signal, fetcher)
      await fs.copyFile(noticeCache, path.join(extracted, name))
    }
    const receipt = {
      kind,
      version: release.version,
      platform,
      arch,
      archiveSha256: asset.sha256,
      source: release.baseUrl + asset.file,
      license: release.license,
      files: await inventory(extracted)
    }
    await fs.writeFile(
      path.join(extracted, 'runtime-receipt.json'),
      JSON.stringify(receipt, null, 2) + '\n',
      { mode: 0o600 }
    )
    onProgress?.('verifying-runtime', 85)
    await verifyDistribution(extracted, kind, platform, arch)
    // Never overwrite an active installation. Caller activates only after validation.
    await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 })
    await fs.rename(extracted, destination)
    return receipt
  } finally {
    await fs.rm(staging, { recursive: true, force: true })
  }
}

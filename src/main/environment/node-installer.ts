import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import semver from 'semver'
import { x as extractTar } from 'tar'
import extractZip from 'extract-zip'
import { environmentDownloadsDir, managedNodeRoot } from '../services/app-paths'
import { EnvironmentError } from '../services/errors'
import {
  detectNodeRuntime,
  isNodeVersionSupported,
  managedNodeBinDirectory,
  normalizeNodeVersion
} from '../pi/node-environment'
import { persistUserPath, refreshRuntimePath } from './path-manager'
import { readExecutableVersion } from './command-resolver'

const NODE_DIST_URL = 'https://nodejs.org/dist'

export interface NodeInstallProgress {
  phase: string
  progress: number
  message: string
}

export interface NodeInstallResult {
  skipped: boolean
  version: string
  root: string
  nodePath: string
  npmPath: string
}

interface NodeRelease {
  version: string
  lts: string | false
  files?: string[]
}

interface NodeInstallerDependencies {
  platform: NodeJS.Platform
  arch: string
  root: () => string
  downloads: () => string
  fetch: typeof globalThis.fetch
  uuid: () => string
}

export class NodeInstaller {
  private readonly dependencies: NodeInstallerDependencies

  constructor(dependencies: Partial<NodeInstallerDependencies> = {}) {
    this.dependencies = {
      platform: process.platform,
      arch: process.arch,
      root: managedNodeRoot,
      downloads: environmentDownloadsDir,
      fetch: globalThis.fetch,
      uuid: randomUUID,
      ...dependencies
    }
  }

  detect() {
    return detectNodeRuntime()
  }

  async resolveRecommendedVersion(signal?: AbortSignal): Promise<string> {
    let response: Response
    try {
      response = await this.dependencies.fetch(`${NODE_DIST_URL}/index.json`, {
        signal,
        cache: 'no-store'
      })
    } catch (error) {
      throw networkError('Could not query official Node.js releases', error)
    }
    if (!response.ok) {
      throw new EnvironmentError('NODE_DOWNLOAD_FAILED', 'Node.js release query failed', {
        status: response.status
      })
    }
    const releases = (await response.json()) as NodeRelease[]
    const supported = releases.filter(
      (release) =>
        isNodeVersionSupported(release.version) &&
        !release.version.includes('-') &&
        releaseSupports(release, this.dependencies.platform, this.dependencies.arch)
    )
    const candidates = supported.filter((release) => Boolean(release.lts))
    const selected = (candidates.length ? candidates : supported).sort((left, right) =>
      semver.rcompare(normalizeNodeVersion(left.version)!, normalizeNodeVersion(right.version)!)
    )[0]
    if (!selected) {
      throw new EnvironmentError(
        'NODE_INSTALL_FAILED',
        `No supported Node.js release is available for ${this.dependencies.platform}/${this.dependencies.arch}`
      )
    }
    return selected.version
  }

  async install(
    options: {
      signal?: AbortSignal
      onProgress?: (progress: NodeInstallProgress) => void
      onLog?: (message: string) => void
    } = {}
  ): Promise<NodeInstallResult> {
    const progress = (phase: string, value: number, message: string) => {
      options.onProgress?.({ phase, progress: value, message })
      options.onLog?.(message)
    }
    progress('checking-node', 2, `Checking ${this.dependencies.platform}/${this.dependencies.arch}`)
    const current = await this.detect()
    if (current.nodeSupported && current.npmInstalled && current.nodePath && current.npmPath) {
      progress('node-ready', 100, `Using existing Node.js ${current.nodeVersion}`)
      return {
        skipped: true,
        version: normalizeNodeVersion(current.nodeVersion) ?? current.nodeVersion ?? '',
        root: path.dirname(current.nodePath),
        nodePath: current.nodePath,
        npmPath: current.npmPath
      }
    }

    progress('resolving-node-version', 10, 'Resolving the recommended stable Node.js release')
    const version = await this.resolveRecommendedVersion(options.signal)
    const artifact = artifactName(version, this.dependencies.platform, this.dependencies.arch)
    const downloads = path.resolve(this.dependencies.downloads())
    const archive = path.join(downloads, artifact)
    await fs.mkdir(downloads, { recursive: true })

    progress('resolving-node-version', 15, `Selected Node.js ${version}`)
    const expectedHash = await this.fetchChecksum(version, artifact, options.signal)
    await this.download(version, artifact, archive, options.signal, (received, total) => {
      const ratio = total > 0 ? Math.min(received / total, 1) : 0
      progress(
        'downloading-node',
        15 + Math.round(ratio * 45),
        total > 0
          ? `Downloading Node.js ${Math.round(ratio * 100)}%`
          : `Downloading Node.js (${Math.round(received / 1024 / 1024)} MB)`
      )
    })
    const actualHash = await sha256File(archive)
    if (actualHash !== expectedHash) {
      throw new EnvironmentError('NODE_DOWNLOAD_FAILED', 'Node.js archive checksum mismatch', {
        artifact,
        expectedHash,
        actualHash
      })
    }
    progress('verifying-node-download', 60, 'Verified the official Node.js archive checksum')

    const root = path.resolve(this.dependencies.root())
    assertSafeManagedRoot(root)
    const parent = path.dirname(root)
    const staging = path.join(parent, `.node-install-${this.dependencies.uuid()}`)
    const backup = path.join(parent, `.node-rollback-${this.dependencies.uuid()}`)
    await fs.mkdir(parent, { recursive: true })
    await fs.rm(staging, { recursive: true, force: true })
    await fs.mkdir(staging, { recursive: true })
    let movedExisting = false
    let installed = false
    try {
      progress('extracting-node', 65, 'Extracting Node.js into the managed user runtime')
      await this.extractArchive(archive, staging)
      const extracted = await extractedRoot(staging, this.dependencies.platform)
      const existing = await fs.lstat(root).catch(() => null)
      if (existing) {
        await fs.rename(root, backup)
        movedExisting = true
      }
      await fs.rename(extracted, root)
      installed = true
      progress('installing-node', 82, 'Installed Node.js without administrator privileges')

      const binDir = managedNodeBinDirectory(root)
      progress('configuring-path', 86, 'Adding the managed Node.js runtime to the user PATH')
      await persistUserPath([binDir], { signal: options.signal })
      await refreshRuntimePath([binDir])
      progress('verifying-node', 92, 'Verifying Node.js and npm executables')
      const nodePath = path.join(
        root,
        this.dependencies.platform === 'win32' ? 'node.exe' : 'bin/node'
      )
      const npmPath = path.join(
        root,
        this.dependencies.platform === 'win32' ? 'npm.cmd' : 'bin/npm'
      )
      const [nodeVersion, npmVersion] = await Promise.all([
        readExecutableVersion(nodePath),
        readExecutableVersion(npmPath)
      ])
      if (!isNodeVersionSupported(nodeVersion) || !npmVersion) {
        throw new EnvironmentError('NODE_INSTALL_FAILED', 'Installed Node.js verification failed', {
          nodeVersion,
          npmVersion
        })
      }
      await fs.rm(backup, { recursive: true, force: true }).catch(() => undefined)
      progress('node-ready', 100, `Node.js ${nodeVersion} and npm ${npmVersion} are ready`)
      return {
        skipped: false,
        version: normalizeNodeVersion(nodeVersion) ?? nodeVersion!,
        root,
        nodePath,
        npmPath
      }
    } catch (error) {
      if (installed) await fs.rm(root, { recursive: true, force: true }).catch(() => undefined)
      if (movedExisting) await fs.rename(backup, root).catch(() => undefined)
      if (isAbortError(error) || options.signal?.aborted) {
        throw new EnvironmentError('INSTALL_CANCELLED', 'Node.js installation was cancelled')
      }
      if (error instanceof EnvironmentError) throw error
      throw new EnvironmentError('NODE_INSTALL_FAILED', 'Node.js installation failed', {
        message: error instanceof Error ? error.message : String(error)
      })
    } finally {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined)
      await fs.rm(archive, { force: true }).catch(() => undefined)
    }
  }

  private async fetchChecksum(
    version: string,
    artifact: string,
    signal?: AbortSignal
  ): Promise<string> {
    let response: Response
    try {
      response = await this.dependencies.fetch(`${NODE_DIST_URL}/${version}/SHASUMS256.txt`, {
        signal,
        cache: 'no-store'
      })
    } catch (error) {
      throw networkError('Could not download the Node.js checksum list', error)
    }
    if (!response.ok) {
      throw new EnvironmentError('NODE_DOWNLOAD_FAILED', 'Node.js checksum query failed', {
        status: response.status
      })
    }
    const line = (await response.text())
      .split(/\r?\n/)
      .find((entry) => entry.trim().endsWith(`  ${artifact}`))
    const hash = line?.trim().split(/\s+/)[0]
    if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) {
      throw new EnvironmentError('NODE_DOWNLOAD_FAILED', 'Official Node.js checksum is missing', {
        artifact
      })
    }
    return hash.toLowerCase()
  }

  private async download(
    version: string,
    artifact: string,
    destination: string,
    signal: AbortSignal | undefined,
    onProgress: (received: number, total: number) => void
  ): Promise<void> {
    let response: Response
    try {
      response = await this.dependencies.fetch(`${NODE_DIST_URL}/${version}/${artifact}`, {
        signal,
        cache: 'no-store'
      })
    } catch (error) {
      throw networkError('Could not download Node.js', error)
    }
    if (!response.ok || !response.body) {
      throw new EnvironmentError('NODE_DOWNLOAD_FAILED', 'Node.js download failed', {
        status: response.status,
        artifact
      })
    }
    const total = Number(response.headers.get('content-length') ?? 0)
    const file = await fs.open(destination, 'w', 0o600)
    let received = 0
    try {
      const reader = response.body.getReader()
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
        await file.write(chunk.value)
        received += chunk.value.byteLength
        onProgress(received, total)
      }
    } finally {
      await file.close()
    }
  }

  private async extractArchive(archive: string, staging: string): Promise<void> {
    if (this.dependencies.platform === 'win32') {
      await extractZip(archive, { dir: staging })
      return
    }
    await extractTar({ file: archive, cwd: staging, strip: 1, preservePaths: false })
  }
}

export function artifactName(version: string, platform: NodeJS.Platform, arch: string): string {
  if (!['x64', 'arm64'].includes(arch)) {
    throw new EnvironmentError('NODE_INSTALL_FAILED', `Unsupported Node.js architecture: ${arch}`)
  }
  if (platform === 'win32') return `node-${version}-win-${arch}.zip`
  if (platform === 'darwin') return `node-${version}-darwin-${arch}.tar.gz`
  if (platform === 'linux') return `node-${version}-linux-${arch}.tar.gz`
  throw new EnvironmentError('NODE_INSTALL_FAILED', `Unsupported Node.js platform: ${platform}`)
}

function releaseSupports(release: NodeRelease, platform: NodeJS.Platform, arch: string): boolean {
  const key =
    platform === 'win32'
      ? `win-${arch}-zip`
      : platform === 'darwin'
        ? `osx-${arch}-tar`
        : platform === 'linux'
          ? `linux-${arch}`
          : ''
  return Boolean(key && release.files?.includes(key))
}

async function extractedRoot(staging: string, platform: NodeJS.Platform): Promise<string> {
  if (platform !== 'win32') return staging
  const entries = (await fs.readdir(staging, { withFileTypes: true })).filter((entry) =>
    entry.isDirectory()
  )
  if (entries.length !== 1) {
    throw new EnvironmentError('NODE_INSTALL_FAILED', 'Unexpected Node.js archive layout')
  }
  return path.join(staging, entries[0].name)
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256')
  const handle = await fs.open(file, 'r')
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024)
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null)
      if (!bytesRead) break
      hash.update(buffer.subarray(0, bytesRead))
    }
  } finally {
    await handle.close()
  }
  return hash.digest('hex')
}

function assertSafeManagedRoot(root: string): void {
  const parsed = path.parse(root)
  const normalized = path.resolve(root)
  const unsafeRoots = new Set([
    path.resolve(parsed.root),
    path.resolve(homedir()),
    path.resolve(process.cwd())
  ])
  if (
    unsafeRoots.has(normalized) ||
    path.dirname(normalized) === normalized ||
    !/^node(?:js)?$/i.test(path.basename(normalized))
  ) {
    throw new EnvironmentError('NODE_INSTALL_FAILED', 'Managed Node.js root is unsafe')
  }
}

function networkError(message: string, cause: unknown): EnvironmentError {
  const text = cause instanceof Error ? cause.message : String(cause)
  const code = /ETIMEDOUT|ECONNRESET|ENETUNREACH|EAI_AGAIN|fetch failed/i.test(text)
    ? 'NETWORK_ERROR'
    : 'NODE_DOWNLOAD_FAILED'
  return new EnvironmentError(code, message, { message: text })
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

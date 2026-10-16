#!/usr/bin/env node
/**
 * Run electron-builder --linux with a host-native mksquashfs on Apple Silicon.
 *
 * electron-builder's bundled AppImage toolset ships darwin/mksquashfs as
 * x86_64. On arm64 Macs without Rosetta that spawn fails with
 * "Unknown system error -86" (EBADARCH). Linux CI is unaffected.
 */
import { createWriteStream } from 'node:fs'
import { createRequire } from 'node:module'
import { cp, mkdir, rm } from 'node:fs/promises'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const execFileAsync = promisify(execFile)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SQUASHFS_VERSION = '4.6.1'
const SQUASHFS_URL = `https://github.com/plougher/squashfs-tools/archive/refs/tags/${SQUASHFS_VERSION}.tar.gz`
const SQUASHFS_SHA256 = '9c4974e07c61547dae14af4ed1f358b7d04618ae194e54d6be72ee126f0d2f53'
const require = createRequire(import.meta.url)
const builderRequire = createRequire(require.resolve('electron-builder'))

export function hostNeedsNativeMksquashfs(platform = process.platform, arch = process.arch) {
  return platform === 'darwin' && arch === 'arm64'
}

async function canSpawn(filePath) {
  try {
    await execFileAsync(filePath, ['-version'], { timeout: 8_000 })
    return true
  } catch {
    return false
  }
}

async function findAppImageToolset() {
  // Reuse the installed builder's download, checksum and cache resolution.
  const { getAppImageTools } = builderRequire('app-builder-lib/out/toolsets/linux.js')
  const { Arch } = builderRequire('builder-util')
  const tools = await getAppImageTools('0.0.0', Arch.x64)
  return path.dirname(tools.runtime)
}

async function compileNativeMksquashfs(outFile) {
  const work = path.join(root, 'out', '.cache', 'squashfs-tools')
  await mkdir(work, { recursive: true })
  const archive = path.join(work, `squashfs-tools-${SQUASHFS_VERSION}.tar.gz`)
  const sourceDir = path.join(work, `squashfs-tools-${SQUASHFS_VERSION}`, 'squashfs-tools')
  const checksum = async () =>
    createHash('sha256')
      .update(await readFile(archive))
      .digest('hex')
  if ((await checksum().catch(() => null)) !== SQUASHFS_SHA256) {
    const response = await fetch(SQUASHFS_URL, { signal: AbortSignal.timeout(180_000) })
    if (!response.ok || !response.body) {
      throw new Error(`failed to download squashfs-tools ${SQUASHFS_VERSION}: ${response.status}`)
    }
    await pipeline(response.body, createWriteStream(archive))
  }
  if ((await checksum()) !== SQUASHFS_SHA256)
    throw new Error('squashfs-tools source checksum mismatch')
  await rm(path.join(work, `squashfs-tools-${SQUASHFS_VERSION}`), { recursive: true, force: true })
  await execFileAsync('/usr/bin/tar', ['-xzf', archive, '-C', work], { cwd: work })
  await execFileAsync(
    '/usr/bin/make',
    [
      `-j${os.cpus().length}`,
      'GZIP_SUPPORT=1',
      'XZ_SUPPORT=0',
      'LZO_SUPPORT=0',
      'LZ4_SUPPORT=0',
      'ZSTD_SUPPORT=0',
      'XATTR_SUPPORT=0'
    ],
    { cwd: sourceDir, env: { ...process.env, CFLAGS: '-O2 -D_DARWIN_C_SOURCE' } }
  )
  await mkdir(path.dirname(outFile), { recursive: true })
  await cp(path.join(sourceDir, 'mksquashfs'), outFile)
}

export async function prepareAppImageTools() {
  if (!hostNeedsNativeMksquashfs()) return process.env
  const source = await findAppImageToolset()
  const staged = path.join(root, 'out', '.cache', 'appimage-darwin-arm64')
  const stagedMksquashfs = path.join(staged, 'darwin', 'mksquashfs')
  const nativeMksquashfs = path.join(root, 'out', '.cache', 'mksquashfs-darwin-arm64')
  process.stdout.write('[linux-builder] compiling verified native mksquashfs for Apple Silicon\n')
  await compileNativeMksquashfs(nativeMksquashfs)
  await rm(staged, { recursive: true, force: true })
  await cp(source, staged, { recursive: true, verbatimSymlinks: true })
  await cp(nativeMksquashfs, stagedMksquashfs)
  if (!(await canSpawn(stagedMksquashfs))) {
    throw new Error(`native mksquashfs still cannot spawn: ${stagedMksquashfs}`)
  }
  process.stdout.write('[linux-builder] using native AppImage tools for Apple Silicon\n')
  return { ...process.env, APPIMAGE_TOOLS_PATH: staged }
}

function parseArgs(argv) {
  const extra = []
  if (argv.includes('--nomascot')) extra.push('--config', 'electron-builder.nomascot.yml')
  return extra
}

async function main() {
  const env = await prepareAppImageTools()
  const child = spawn(
    'pnpm',
    [
      'exec',
      'electron-builder',
      '--publish',
      'never',
      '--linux',
      '--x64',
      ...parseArgs(process.argv.slice(2))
    ],
    { cwd: root, env, stdio: 'inherit' }
  )
  child.on('error', (error) => {
    console.error(error.message)
    process.exitCode = 1
  })
  child.on('exit', (code, signal) => {
    if (signal) process.exit(1)
    process.exit(code ?? 1)
  })
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}

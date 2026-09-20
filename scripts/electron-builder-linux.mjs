#!/usr/bin/env node
/**
 * Run electron-builder --linux with a host-native mksquashfs on Apple Silicon.
 *
 * electron-builder's bundled AppImage toolset ships darwin/mksquashfs as
 * x86_64. On arm64 Macs without Rosetta that spawn fails with
 * "Unknown system error -86" (EBADARCH). Linux CI is unaffected.
 */
import { createWriteStream } from 'node:fs'
import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SQUASHFS_VERSION = '4.6.1'
const SQUASHFS_URL = `https://github.com/plougher/squashfs-tools/archive/refs/tags/${SQUASHFS_VERSION}.tar.gz`
const CACHE_ROOT = path.join(os.homedir(), 'Library', 'Caches', 'electron-builder')

export function hostNeedsNativeMksquashfs(platform = process.platform, arch = process.arch) {
  return platform === 'darwin' && arch === 'arm64'
}

async function fileDescribesX86_64(filePath) {
  try {
    const { stdout } = await execFileAsync('/usr/bin/file', ['-b', filePath])
    return /\bx86_64\b/.test(stdout)
  } catch {
    return false
  }
}

async function canSpawn(filePath) {
  try {
    await execFileAsync(filePath, ['-version'], { timeout: 8_000 })
    return true
  } catch (error) {
    const err = error
    if (err?.errno === -86 || err?.code === 'ERR_UNKNOWN_SIGNAL') return false
    const message = String(err?.message ?? error)
    if (message.includes('Unknown system error -86') || message.includes('Bad CPU type')) return false
    if (err?.code === 'ENOENT') return false
    // Spawned; -version may still exit non-zero on some builds.
    return true
  }
}

async function findExtractedAppImageToolset() {
  const parent = path.join(CACHE_ROOT, 'appimage-12.0.1')
  let entries
  try {
    entries = await readdir(parent, { withFileTypes: true })
  } catch {
    return null
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const candidate = path.join(parent, entry.name, 'darwin', 'mksquashfs')
    try {
      await stat(candidate)
      return path.join(parent, entry.name)
    } catch {
      continue
    }
  }
  return null
}

async function compileNativeMksquashfs(outFile) {
  const work = path.join(root, 'out', '.cache', 'squashfs-tools')
  await mkdir(work, { recursive: true })
  const archive = path.join(work, `squashfs-tools-${SQUASHFS_VERSION}.tar.gz`)
  const sourceDir = path.join(work, `squashfs-tools-${SQUASHFS_VERSION}`, 'squashfs-tools')
  try {
    await stat(archive)
  } catch {
    const response = await fetch(SQUASHFS_URL)
    if (!response.ok || !response.body) {
      throw new Error(`failed to download squashfs-tools ${SQUASHFS_VERSION}: ${response.status}`)
    }
    await pipeline(response.body, createWriteStream(archive))
  }
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

async function prepareAppImageTools() {
  if (!hostNeedsNativeMksquashfs()) return process.env
  const source = await findExtractedAppImageToolset()
  if (!source) {
    throw new Error(
      'electron-builder AppImage toolset is not cached yet. Re-run this script after electron-builder has downloaded appimage-12.0.1, or build Linux on ubuntu-latest.'
    )
  }
  const staged = path.join(root, 'out', '.cache', 'appimage-12.0.1')
  const stagedMksquashfs = path.join(staged, 'darwin', 'mksquashfs')
  const nativeMksquashfs = path.join(root, 'out', '.cache', 'mksquashfs-darwin-arm64')
  if (!(await canSpawn(nativeMksquashfs))) {
    process.stdout.write('[linux-builder] compiling native mksquashfs for Apple Silicon\n')
    await compileNativeMksquashfs(nativeMksquashfs)
  }
  if (!(await canSpawn(stagedMksquashfs)) || (await fileDescribesX86_64(stagedMksquashfs))) {
    await rm(staged, { recursive: true, force: true })
    await cp(source, staged, { recursive: true })
    await cp(nativeMksquashfs, stagedMksquashfs)
  }
  if (!(await canSpawn(stagedMksquashfs))) {
    throw new Error(`native mksquashfs still cannot spawn: ${stagedMksquashfs}`)
  }
  process.stdout.write(`[linux-builder] APPIMAGE_TOOLS_PATH=${staged}\n`)
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
    ['exec', 'electron-builder', '--publish', 'never', '--linux', ...parseArgs(process.argv.slice(2))],
    { cwd: root, env, stdio: 'inherit' }
  )
  child.on('exit', (code, signal) => {
    if (signal) process.exit(1)
    process.exit(code ?? 1)
  })
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}

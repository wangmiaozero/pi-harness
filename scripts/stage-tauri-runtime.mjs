#!/usr/bin/env node
/**
 * Stage the Node sidecar, Pi SDK modules, builtin skills, and a platform Node
 * binary into src-tauri/resources for production bundles.
 *
 * Usage: node scripts/stage-tauri-runtime.mjs [--skip-node]
 */

import { createWriteStream } from 'node:fs'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const skipNode = process.argv.includes('--skip-node')
const resources = path.join(root, 'src-tauri', 'resources')
const runtimeDest = path.join(resources, 'runtime')
const nodeDest = path.join(resources, 'runtime-node')
const skillsDest = path.join(resources, 'builtin-skills')
const dist = path.join(root, 'runtime', 'dist', 'index.js')
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const nodeVersion = process.versions.node.split('.').slice(0, 3).join('.')
const sdkPackages = [
  '@earendil-works/pi-coding-agent',
  '@earendil-works/pi-agent-core',
  '@earendil-works/pi-ai',
  '@earendil-works/pi-tui'
]

if (!existsSync(dist)) {
  execFileSync('pnpm', ['runtime:build'], { cwd: root, stdio: 'inherit' })
}

rmSync(runtimeDest, { recursive: true, force: true })
mkdirSync(runtimeDest, { recursive: true })
cpSync(path.join(root, 'runtime', 'dist'), runtimeDest, { recursive: true })

const stagePkg = {
  name: 'pi-harness-runtime-bundle',
  private: true,
  type: 'module',
  dependencies: Object.fromEntries(
    sdkPackages.map((name) => [name, pkg.dependencies[name] || pkg.devDependencies?.[name]])
  )
}
writeFileSync(path.join(runtimeDest, 'package.json'), `${JSON.stringify(stagePkg, null, 2)}\n`)
writeFileSync(path.join(runtimeDest, '.npmrc'), 'ignore-scripts=true\n')
execFileSync(
  'npm',
  ['install', '--omit=dev', '--no-fund', '--no-audit', '--ignore-scripts'],
  {
    cwd: runtimeDest,
    stdio: 'inherit',
    env: npmInstallEnv()
  }
)

const skillsSrc = path.join(root, 'resources', 'builtin-skills')
if (existsSync(skillsSrc)) {
  rmSync(skillsDest, { recursive: true, force: true })
  mkdirSync(path.dirname(skillsDest), { recursive: true })
  cpSync(skillsSrc, skillsDest, { recursive: true })
}

if (!skipNode) {
  await installBundledNode(nodeDest, nodeVersion)
}

console.warn(`[stage-tauri-runtime] staged ${runtimeDest}`)

function npmInstallEnv() {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    const lower = key.toLowerCase()
    if (
      lower.startsWith('npm_config_') &&
      (lower.includes('auto_install_peers') ||
        lower.includes('electron') ||
        lower.includes('allow_scripts') ||
        lower.includes('allow-scripts'))
    ) {
      delete env[key]
    }
  }
  env.npm_config_ignore_scripts = 'true'
  return env
}

async function installBundledNode(dest, version) {
  const platform = process.platform
  const arch = process.arch === 'x64' ? 'x64' : process.arch === 'arm64' ? 'arm64' : process.arch
  const os =
    platform === 'darwin' ? 'darwin' : platform === 'win32' ? 'win' : platform === 'linux' ? 'linux' : null
  if (!os) {
    throw new Error(`Unsupported Node bundle platform: ${platform}`)
  }
  const ext = platform === 'win32' ? 'zip' : 'tar.gz'
  const folder = `node-v${version}-${os}-${arch}`
  const url = `https://nodejs.org/dist/v${version}/${folder}.${ext}`
  const tmp = mkdtempSync(path.join(tmpdir(), 'pi-node-'))
  const archive = path.join(tmp, `node.${ext}`)
  const response = await fetch(url)
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}`)
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(archive))
  if (platform === 'win32') {
    execFileSync('tar', ['-xf', archive, '-C', tmp], { stdio: 'inherit' })
  } else {
    execFileSync('tar', ['-xzf', archive, '-C', tmp], { stdio: 'inherit' })
  }
  mkdirSync(dest, { recursive: true })
  const binaryName = platform === 'win32' ? 'node.exe' : 'node'
  const extracted = path.join(
    tmp,
    folder,
    platform === 'win32' ? binaryName : path.join('bin', binaryName)
  )
  cpSync(extracted, path.join(dest, binaryName))
  rmSync(tmp, { recursive: true, force: true })
}

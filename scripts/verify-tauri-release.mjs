#!/usr/bin/env node
/**
 * Verify a Tauri production artifact after `pnpm build:tauri`.
 *
 * Usage: node scripts/verify-tauri-release.mjs [bundleDir]
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bundleDir =
  process.argv[2] || path.join(root, 'src-tauri', 'target', 'release', 'bundle')
const errors = []

function fail(message) {
  errors.push(message)
}

const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const cargo = readFileSync(path.join(root, 'src-tauri', 'Cargo.toml'), 'utf8')
const cargoVersion = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1]
if (pkg.version !== cargoVersion) fail(`version mismatch package=${pkg.version} cargo=${cargoVersion}`)

if (!existsSync(bundleDir)) {
  fail(`bundle directory missing: ${bundleDir}`)
} else {
  const entries = walk(bundleDir)
  if (!entries.some((item) => item.endsWith('.app') || item.endsWith('.dmg') || item.endsWith('.exe') || item.endsWith('.AppImage'))) {
    fail('no installer or app bundle found')
  }
  const electronHits = entries.filter((item) =>
    /electron(\.asar| framework| helper)/i.test(item)
  )
  if (electronHits.length) fail(`Electron payload leaked into Tauri bundle: ${electronHits.slice(0, 5).join(', ')}`)
}

const runtime = path.join(root, 'src-tauri', 'resources', 'runtime', 'index.js')
if (!existsSync(runtime)) fail(`staged runtime missing: ${runtime}`)
const nodeName = process.platform === 'win32' ? 'node.exe' : 'node'
const bundledNode = path.join(root, 'src-tauri', 'resources', 'runtime-node', nodeName)
if (!existsSync(bundledNode)) fail(`bundled Node missing: ${bundledNode}`)

if (errors.length) {
  console.error(errors.map((item) => `- ${item}`).join('\n'))
  process.exit(1)
}
console.warn(`Tauri release checks passed (${pkg.version})`)

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    acc.push(full)
    try {
      if (statSync(full).isDirectory() && !name.endsWith('.app')) walk(full, acc)
    } catch {
      /* skip unreadable */
    }
  }
  return acc
}

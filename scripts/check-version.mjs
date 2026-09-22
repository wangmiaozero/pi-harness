#!/usr/bin/env node
/**
 * Single source of truth: package.json version must match Cargo.toml and tauri.conf.json.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const cargo = readFileSync(path.join(root, 'src-tauri', 'Cargo.toml'), 'utf8')
const tauri = JSON.parse(readFileSync(path.join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'))
const cargoVersion = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1]
const mismatches = []
if (pkg.version !== cargoVersion) {
  mismatches.push(`Cargo.toml ${cargoVersion} != package.json ${pkg.version}`)
}
if (pkg.version !== tauri.version) {
  mismatches.push(`tauri.conf.json ${tauri.version} != package.json ${pkg.version}`)
}
if (mismatches.length) {
  console.error(`Version mismatch:\n- ${mismatches.join('\n- ')}`)
  process.exit(1)
}
console.warn(`version ${pkg.version} ok`)

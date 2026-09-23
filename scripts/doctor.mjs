#!/usr/bin/env node
/**
 * Development-environment check. Does not read provider keys or call user APIs.
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const checks = [
  ['node', ['--version'], 'Node.js'],
  ['pnpm', ['--version'], 'pnpm'],
  ['git', ['--version'], 'Git'],
  ['rustc', ['--version'], 'Rust'],
  ['cargo', ['--version'], 'Cargo']
]

let failed = 0
for (const [command, args, label] of checks) {
  try {
    const output = execFileSync(command, args, { encoding: 'utf8' }).trim().split('\n')[0]
    console.warn(`${label}: ${output}`)
  } catch {
    failed += 1
    console.error(`${label}: missing (${command})`)
  }
}

const nodeMajor = Number(process.versions.node.split('.')[0])
if (nodeMajor < 22) {
  failed += 1
  console.error(`Node.js ${process.versions.node} is below 22`)
}

if (!existsSync('src-tauri/tauri.conf.json')) {
  failed += 1
  console.error('Tauri config missing: src-tauri/tauri.conf.json')
}

if (failed) {
  console.error(`doctor: ${failed} check(s) failed`)
  process.exit(1)
}
console.warn('doctor: ok')

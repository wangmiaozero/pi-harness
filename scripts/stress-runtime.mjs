#!/usr/bin/env node
/**
 * Restart the sidecar in a loop and record time-to-ready.
 * Not a GUI soak test. CYCLES defaults to 20.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const script = path.join(root, 'runtime', 'dist', 'index.js')
const cycles = Number(process.env.CYCLES || 20)

if (!existsSync(script)) {
  console.error('runtime/dist/index.js missing. Run pnpm runtime:build')
  process.exit(1)
}

const samples = []
for (let index = 1; index <= cycles; index += 1) {
  const ms = await once(index)
  samples.push(ms)
  console.warn(`cycle ${index}: ${Math.round(ms)}ms`)
}

const sorted = [...samples].sort((a, b) => a - b)
const sum = samples.reduce((total, value) => total + value, 0)
console.warn(
  JSON.stringify(
    {
      cycles,
      minMs: Math.round(sorted[0]),
      medianMs: Math.round(sorted[Math.floor(sorted.length / 2)]),
      maxMs: Math.round(sorted.at(-1)),
      meanMs: Math.round(sum / samples.length)
    },
    null,
    2
  )
)

function once(generation) {
  return new Promise((resolve, reject) => {
    const started = performance.now()
    const child = spawn(process.execPath, [script], {
      cwd: root,
      env: {
        ...process.env,
        PI_HARNESS_RUNTIME_GENERATION: `runtime-${String(generation).padStart(3, '0')}`
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let buffer = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`cycle ${generation} timed out`))
    }, 15000)
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString()
      if (!buffer.includes('"event":"runtime.ready"')) return
      clearTimeout(timer)
      child.kill('SIGTERM')
      resolve(performance.now() - started)
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

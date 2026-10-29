import path from 'node:path'
import { spawn } from 'node:child_process'
import { summarize } from './summary.mjs'

const pnpm = process.env.npm_execpath
if (!pnpm) throw new Error('Run this benchmark through pnpm benchmark:desktop')
if (/\.(?:cmd|bat)$/i.test(pnpm))
  throw new Error('Use a Node-based or standalone pnpm executable for this benchmark')
const nodePnpm = /\.(?:cjs|mjs|js)$/i.test(pnpm)
const rounds = Number(process.env.PI_HARNESS_PERF_ROUNDS ?? 3)
if (!Number.isSafeInteger(rounds) || rounds < 1 || rounds > 10)
  throw new Error('Invalid benchmark rounds')
const metricsDirectory = path.resolve('out/quality', `desktop-${Date.now()}-${process.pid}`)
async function run(args, env = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(nodePnpm ? process.execPath : pnpm, nodePnpm ? [pnpm, ...args] : args, {
      stdio: 'inherit',
      shell: false,
      env: { ...process.env, PI_HARNESS_PERF_OUTPUT: metricsDirectory, ...env }
    })
    child.once('error', reject)
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`Benchmark command failed (${code})`))
    )
  })
}
if (!process.argv.includes('--no-build')) await run(['compile'])
for (let round = 1; round <= rounds; round++) {
  for (const [count, mixed] of [
    [100, false],
    [500, false],
    [1000, false],
    [3000, false],
    [1000, true],
    [3000, true]
  ]) {
    await run(['test:e2e:only', 'e2e/performance.spec.ts', '--grep', 'streams into'], {
      PI_HARNESS_PERF_MESSAGES: String(count),
      PI_HARNESS_PERF_LIFECYCLE:
        process.env.PI_HARNESS_PERF_LIFECYCLE === '1' && round === 1 && count >= 1000 ? '1' : '0',
      PI_HARNESS_PERF_MIXED: mixed ? '1' : '0',
      PI_HARNESS_PERF_LABEL: `round-${round}`
    })
  }
}
await run(['test:e2e:only', 'e2e/quality-performance.spec.ts'])
await summarize(metricsDirectory)
process.stdout.write(`Desktop performance report: ${metricsDirectory}\n`)

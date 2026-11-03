import { spawn } from 'node:child_process'
import path from 'node:path'

const pnpm = process.env.npm_execpath
if (!pnpm || /\.(?:cmd|bat)$/i.test(pnpm))
  throw new Error('Run through pnpm benchmark:navigation with a Node-based or standalone pnpm')
const nodePnpm = /\.(?:cjs|mjs|js)$/i.test(pnpm)
const output = path.resolve(
  process.env.PI_HARNESS_PERF_OUTPUT ?? `out/quality/navigation-${Date.now()}`
)
async function run(args) {
  await new Promise((resolve, reject) => {
    const child = spawn(nodePnpm ? process.execPath : pnpm, nodePnpm ? [pnpm, ...args] : args, {
      stdio: 'inherit',
      shell: false,
      env: { ...process.env, PI_HARNESS_NAV_BENCHMARK: '1', PI_HARNESS_PERF_OUTPUT: output }
    })
    child.once('error', reject)
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`Navigation benchmark failed (${code})`))
    )
  })
}
if (!process.argv.includes('--no-build')) await run(['compile'])
await run(['test:e2e:only', 'e2e/interaction-performance.spec.ts'])
process.stdout.write(`Navigation performance report: ${output}\n`)

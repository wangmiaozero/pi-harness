import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const child = spawn(
  process.execPath,
  [
    path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs'),
    'run',
    'src/main/runtime',
    'src/main/agent/pi-rpc-runtime.test.ts'
  ],
  {
    stdio: 'inherit',
    env: { ...process.env, PI_HARNESS_REQUIRE_RUNTIME_TESTS: '1' }
  }
)
child.once('error', (error) => {
  console.error(error.message)
  process.exitCode = 1
})
child.once('exit', (code) => {
  process.exitCode = code ?? 1
})

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { runtimeLayout, verifyDistribution } from '../../src/main/runtime/distribution.mjs'

const root = path.resolve('resources/runtimes', `${process.platform}-${process.arch}`)
for (const kind of ['pi', 'node'])
  await verifyDistribution(path.join(root, kind), kind, process.platform, process.arch)
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-runtime-benchmark-'))
const pi = path.join(root, 'pi', runtimeLayout('pi', process.platform).executable)
const node = path.join(root, 'node', runtimeLayout('node', process.platform).executable)
const env = {
  PATH: temporary,
  HOME: temporary,
  USERPROFILE: temporary,
  TEMP: temporary,
  TMP: temporary,
  SystemRoot: process.env.SystemRoot,
  PI_CODING_AGENT_DIR: path.join(temporary, 'agent')
}
const samples = []
try {
  for (let index = 0; index < 5; index++) {
    const start = performance.now()
    const child = spawn(
      pi,
      ['--mode', 'rpc', '--no-session', '--no-extensions', '--no-skills', '--no-mcp'],
      { cwd: temporary, env, stdio: ['pipe', 'pipe', 'ignore'] }
    )
    const exit = new Promise((resolve) => child.once('close', resolve))
    let data = ''
    let timeout
    try {
      await new Promise((resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('Pi benchmark RPC timed out')), 15_000)
        child.once('error', reject)
        child.stdout.setEncoding('utf8')
        child.stdout.on('data', (chunk) => {
          data += chunk
          if (data.includes('"command":"get_state"')) resolve()
        })
        child.stdin.write(JSON.stringify({ id: 'benchmark', type: 'get_state' }) + '\n')
      })
      const startupMs = performance.now() - start
      const rss =
        process.platform === 'win32'
          ? null
          : Number(
              (
                await promisify(execFile)('/bin/ps', ['-o', 'rss=', '-p', String(child.pid)])
              ).stdout.trim()
            ) * 1024
      samples.push({ startupMs: Math.round(startupMs * 100) / 100, piRssBytes: rss })
    } finally {
      clearTimeout(timeout)
      child.stdin.end()
      const force = setTimeout(() => child.kill('SIGKILL'), 3000)
      await exit
      clearTimeout(force)
    }
  }
  const nodeStartups = []
  for (let index = 0; index < 5; index++) {
    const start = performance.now()
    await promisify(execFile)(node, ['--version'], { env, timeout: 15_000 })
    nodeStartups.push(Math.round((performance.now() - start) * 100) / 100)
  }
  const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
  const output = {
    platform: process.platform,
    arch: process.arch,
    piFirstProcessMs: samples[0].startupMs,
    piWarmMedianMs: median(samples.slice(1).map((sample) => sample.startupMs)),
    nodeMedianMs: median(nodeStartups),
    samples,
    nodeStartups,
    electronMemoryDelta: 'not measured',
    notes:
      'RPC ready; no model request, no desktop extension or MCP. OS file caches were not flushed. Process RSS is not total application memory.'
  }
  const destination = path.resolve('out/runtime-validation')
  await fs.mkdir(destination, { recursive: true })
  await fs.writeFile(
    path.join(destination, `benchmark-${process.platform}-${process.arch}.json`),
    JSON.stringify(output, null, 2) + '\n'
  )
  process.stdout.write(JSON.stringify(output, null, 2) + '\n')
} finally {
  await fs.rm(temporary, { force: true, recursive: true })
}

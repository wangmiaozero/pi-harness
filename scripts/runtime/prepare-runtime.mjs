import path from 'node:path'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  acquireDistribution,
  verifyDistribution,
  runtimeLayout,
  catalog
} from '../../src/main/runtime/distribution.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const option = (name, fallback) =>
  process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1] ?? fallback
const platform = option('platform', process.platform)
const arch = option('arch', process.arch)
const cache = path.resolve(
  process.env.PI_HARNESS_RUNTIME_CACHE ?? path.join(root, '.runtime-cache')
)
const verifyOnly = process.argv.includes('--verify')
for (const kind of ['pi', 'node']) {
  const destination = path.join(root, 'resources/runtimes', `${platform}-${arch}`, kind)
  const exists = await fs.stat(destination).catch(() => null)
  if (!exists && !verifyOnly)
    await acquireDistribution({
      kind,
      platform,
      arch,
      destination,
      cache,
      offline: process.argv.includes('--offline')
    })
  await verifyDistribution(destination, kind, platform, arch)
  if (platform === process.platform && arch === process.arch) {
    const layout = runtimeLayout(kind, platform)
    const executable = path.join(destination, layout.executable)
    const env = { ...process.env, PATH: path.dirname(executable), ELECTRON_RUN_AS_NODE: undefined }
    const run = async (file, args) =>
      (await promisify(execFile)(file, args, { env, timeout: 30_000 })).stdout.trim()
    const version = await run(executable, ['--version'])
    if (!version.includes(catalog[kind].version)) throw new Error(`${kind} version mismatch`)
    process.stdout.write(`${kind}: ${version}\n`)
    if (kind === 'node') {
      for (const tool of ['npm', 'npx']) {
        const version = await run(executable, [path.join(destination, layout[tool]), '--version'])
        if (version !== catalog.node.npmVersion) throw new Error(`${tool} version mismatch`)
        process.stdout.write(`${tool}: ${version}\n`)
      }
    }
  } else
    process.stdout.write(`${kind}: integrity verified; execution requires ${platform}-${arch}\n`)
}

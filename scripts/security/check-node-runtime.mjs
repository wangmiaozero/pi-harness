import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  assessNodeSecurity,
  nodeSecurityPolicy
} from '../../src/shared/runtime/node-security-policy.mjs'
import {
  catalog,
  verifyDistribution,
  runtimeLayout,
  sha256
} from '../../src/main/runtime/distribution.mjs'
import electronReviews from '../../src/shared/runtime/electron-security-review.json' with { type: 'json' }

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const option = (name) =>
  process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
const sourceOnly = process.argv.includes('--source-only')
const report = {
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  buildPlatform: `${process.platform}-${process.arch}`,
  securityBaseline: nodeSecurityPolicy,
  checks: [],
  electron: {
    status: 'NOT_VERIFIED',
    reason:
      'Electron requires independent upstream backport evidence; an external Node update does not patch Electron.'
  },
  dependencyAudit: { status: 'NOT_VERIFIED', reason: 'Run with --audit to query the registry.' },
  overall: 'NOT_VERIFIED'
}
const add = (name, status, details = {}) => report.checks.push({ name, status, ...details })
for (const [name, version] of [
  ['build', process.versions.node],
  ['catalog', catalog.node.version]
]) {
  const assessment = assessNodeSecurity(version)
  add(name, assessment.executionAllowed && version.split('.')[0] === '24' ? 'PASS' : 'FAIL', {
    version,
    source: name,
    assessment
  })
}
const expectedBase = `https://nodejs.org/dist/v${catalog.node.version}/`
add('official-source', catalog.node.baseUrl === expectedBase ? 'PASS' : 'FAIL', {
  baseUrl: catalog.node.baseUrl
})
const cache = path.resolve(
  process.env.PI_HARNESS_RUNTIME_CACHE ?? path.join(root, '.runtime-cache')
)
try {
  const checksumFile = path.join(
    cache,
    `node-${catalog.node.version}-${catalog.node.checksumsFile}`
  )
  if (process.argv.includes('--online')) {
    const response = await fetch(expectedBase + catalog.node.checksumsFile, {
      redirect: 'error',
      signal: AbortSignal.timeout(30_000)
    })
    if (!response.ok) throw new Error(`Official checksum request: ${response.status}`)
    const { createHash } = await import('node:crypto')
    const data = await response.text()
    if (createHash('sha256').update(data).digest('hex') !== catalog.node.checksumsSha256) {
      add('official-checksum-list', 'FAIL', {
        reason: 'Official checksum list differs from catalog'
      })
    } else add('official-checksum-list', 'PASS', { source: 'https://nodejs.org/dist/' })
  } else if (await fs.stat(checksumFile).catch(() => null)) {
    add(
      'official-checksum-list',
      (await sha256(checksumFile)) === catalog.node.checksumsSha256 ? 'PASS' : 'FAIL',
      { source: 'pinned-official-cache' }
    )
  } else
    add('official-checksum-list', 'NOT_VERIFIED', {
      reason: 'No verified cached checksum list; use --online'
    })
  for (const [target, asset] of Object.entries(catalog.node.assets)) {
    const archive = path.join(cache, asset.file)
    if (await fs.stat(archive).catch(() => null))
      add(`archive:${target}`, (await sha256(archive)) === asset.sha256 ? 'PASS' : 'FAIL', {
        sha256: asset.sha256
      })
  }
} catch (error) {
  add('official-checksum-list', 'NOT_VERIFIED', { reason: error.message })
}
if (!sourceOnly) {
  const targets = process.argv.includes('--all-platforms')
    ? Object.keys(catalog.node.assets)
    : [`${process.platform}-${process.arch}`]
  for (const target of targets) {
    const [platform, arch] = target.split('-')
    const directory = option('installed-root')
      ? path.resolve(option('installed-root'), 'node')
      : path.join(root, 'resources/runtimes', target, 'node')
    try {
      await verifyDistribution(directory, 'node', platform, arch)
      add(`integrity:${target}`, 'PASS', {
        source: option('installed-root') ? 'installed-package' : 'bundled'
      })
      if (platform === process.platform && arch === process.arch) {
        const executable = path.join(directory, runtimeLayout('node', platform).executable)
        const { stdout } = await promisify(execFile)(executable, ['--version'], {
          env: { ...process.env, NODE_OPTIONS: undefined, ELECTRON_RUN_AS_NODE: undefined },
          timeout: 30_000
        })
        const version = stdout.trim().replace(/^v/, '')
        add(
          `execution:${target}`,
          version === catalog.node.version && assessNodeSecurity(version).executionAllowed
            ? 'PASS'
            : 'FAIL',
          { version }
        )
      } else add(`execution:${target}`, 'NOT_VERIFIED', { reason: 'A native runner is required' })
    } catch (error) {
      add(`integrity:${target}`, 'FAIL', { reason: error.message })
    }
  }
}
try {
  const packageJson = JSON.parse(
    await fs.readFile(path.join(root, 'node_modules/electron/package.json'), 'utf8')
  )
  report.electron.version = packageJson.version
  // Version identity is useful evidence, but is not proof of upstream CVE backports.
  const electronModule = await import('electron')
  const { stdout } = await promisify(execFile)(
    electronModule.default,
    ['-p', 'JSON.stringify(process.versions)'],
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: undefined },
      timeout: 30_000
    }
  )
  report.electron.versions = JSON.parse(stdout.trim())
  const review = electronReviews.reviews[packageJson.version]
  if (
    review?.status === 'PASS' &&
    review.node === report.electron.versions.node &&
    review.chromium === report.electron.versions.chrome &&
    Array.isArray(review.sources) &&
    review.sources.length &&
    review.advisory === nodeSecurityPolicy.source
  ) {
    report.electron = {
      ...report.electron,
      ...review,
      reason: 'Exact Electron version has a recorded upstream patch and regression review.'
    }
  }
} catch (error) {
  report.electron.probeError = error.message
}
if (process.argv.includes('--audit')) {
  const cli = process.env.npm_execpath
  if (!cli || !path.isAbsolute(cli))
    report.dependencyAudit.reason = 'Run via pnpm security:node --audit'
  else {
    const javascript = /\.[cm]?js$/i.test(cli)
    const shim = process.platform === 'win32' && /\.(cmd|bat)$/i.test(cli)
    const executable = javascript ? process.execPath : shim ? process.env.ComSpec || 'cmd.exe' : cli
    const arguments_ = [
      ...(javascript ? [cli] : shim ? ['/d', '/s', '/c', cli] : []),
      'audit',
      '--prod',
      '--audit-level',
      'high',
      '--json'
    ]
    let output
    try {
      output = (
        await promisify(execFile)(executable, arguments_, {
          cwd: root,
          timeout: 120_000,
          maxBuffer: 16 * 1024 * 1024
        })
      ).stdout
    } catch (error) {
      output = error.stdout
    }
    try {
      const audit = JSON.parse(output)
      const counts = audit.metadata?.vulnerabilities
      if (!counts || typeof counts.high !== 'number' || typeof counts.critical !== 'number')
        throw new Error('Registry did not return vulnerability counts')
      report.dependencyAudit = {
        status:
          counts.high || counts.critical ? 'FAIL' : counts.moderate || counts.low ? 'WARN' : 'PASS',
        counts,
        advisories: audit.advisories ?? {}
      }
    } catch (error) {
      report.dependencyAudit = { status: 'NOT_VERIFIED', reason: error.message }
    }
  }
}
const states = [
  ...report.checks.map((check) => check.status),
  report.electron.status,
  report.dependencyAudit.status
]
report.overall = states.includes('FAIL')
  ? 'FAIL'
  : states.includes('NOT_VERIFIED')
    ? 'NOT_VERIFIED'
    : states.includes('WARN')
      ? 'WARN'
      : 'PASS'
const output = path.resolve(option('output') ?? path.join(root, 'out/security/node-runtime.json'))
await fs.mkdir(path.dirname(output), { recursive: true })
await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n')
process.stdout.write(JSON.stringify(report, null, 2) + '\n')
if (report.overall === 'FAIL' || (process.argv.includes('--release') && report.overall !== 'PASS'))
  process.exitCode = 1

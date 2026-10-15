import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.join(root, 'out', 'quality')
await fs.mkdir(output, { recursive: true })
const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
if (process.env.PI_HARNESS_EXPECTED_ARCH && process.env.PI_HARNESS_EXPECTED_ARCH !== process.arch)
  throw new Error('The runner architecture does not match the native test matrix')
const exec = promisify(execFile)
const revision = (await exec('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim()
async function sourceFingerprint() {
  const files = (
    await exec('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd: root
    })
  ).stdout
    .split('\0')
    .filter((file) =>
      /^(?:src\/|scripts\/|e2e\/|benchmarks\/|resources\/|build\/|\.github\/|package\.json$|pnpm-lock\.yaml$|(?:electron|vitest|playwright|eslint|tsconfig)[^/]*\.(?:ts|mjs|json|yml)$)/.test(
        file
      )
    )
    .sort()
  const digest = createHash('sha256')
  for (const file of files) {
    const stat = await fs.lstat(path.join(root, file))
    let contents = stat.isSymbolicLink()
      ? Buffer.from(await fs.readlink(path.join(root, file)))
      : await fs.readFile(path.join(root, file))
    if (!contents.includes(0)) {
      try {
        contents = Buffer.from(
          new TextDecoder('utf-8', { fatal: true }).decode(contents).replaceAll('\r\n', '\n')
        )
      } catch {
        /* Binary resources retain their byte identity. */
      }
    }
    digest.update(`${file}\0${contents.length}\0`)
    digest.update(contents)
  }
  return digest.digest('hex')
}
const packageRequested = process.argv.includes('--package')
const report = {
  schemaVersion: 1,
  version: manifest.version,
  revision,
  sourceDigest: await sourceFingerprint(),
  generatedAt: new Date().toISOString(),
  environment: {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    os: os.release()
  },
  checks: [],
  platformVerification: {},
  readiness: 'NOT_READY'
}
let stagedPackage
const reportPath = path.join(output, `quality-${process.platform}-${process.arch}.json`)
async function save() {
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
  await fs.writeFile(
    reportPath.replace(/\.json$/, '.md'),
    [
      `# Release readiness: ${report.readiness}`,
      '',
      `Version: ${report.version}; native environment: ${process.platform}/${process.arch}; ${process.version}.`,
      '',
      ...report.checks.map(
        (check) =>
          `- ${check.name}: ${check.status}${check.durationMs === undefined ? '' : ` (${check.durationMs} ms)`}`
      ),
      '',
      'A packaged executable smoke test does not verify an OS installer, signing, notarization or an end-to-end updater. Other native platforms require their own reports.'
    ].join('\n') + '\n'
  )
}
async function run(name, arguments_, environment = {}) {
  if (arguments_.includes('playwright') && arguments_.includes('test')) {
    arguments_ = [
      ...arguments_,
      '--output',
      path.join(output, `${name}-artifacts`),
      '--trace',
      'retain-on-failure'
    ]
  }
  const started = performance.now()
  const logPath = path.join(output, `${name}.log`)
  const log = await fs.open(logPath, 'w')
  const pnpm = process.env.npm_execpath
  if (!pnpm) throw new Error('Run the gate through pnpm quality')
  const javascriptEntry = /\.(?:cjs|mjs|js)$/i.test(pnpm)
  const windowsShim = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(pnpm)
  const executable = javascriptEntry
    ? process.execPath
    : windowsShim
      ? process.env.ComSpec || 'cmd.exe'
      : pnpm
  const args = javascriptEntry
    ? [pnpm, ...arguments_]
    : windowsShim
      ? ['/d', '/s', '/c', pnpm, ...arguments_]
      : arguments_
  const code = await new Promise((resolve) => {
    const child = spawn(executable, args, {
      cwd: root,
      env: { ...process.env, ...environment },
      stdio: ['ignore', log.fd, log.fd]
    })
    child.once('error', () => resolve(-1))
    child.once('close', (code) => resolve(code ?? -1))
  })
  await log.close()
  const status = code === 0 ? 'PASS' : 'FAIL'
  report.checks.push({
    name,
    status,
    required: true,
    exitCode: code,
    durationMs: Math.round(performance.now() - started),
    log: path.basename(logPath)
  })
  process.stdout.write(`${name}: ${status}\n`)
  await save()
  if (code !== 0) {
    process.stderr.write(`${name} failed; see ${logPath}\n`)
    process.exitCode = 1
  }
  return code === 0
}
try {
  for (const command of ['typecheck', 'lint', 'test', 'compile']) await run(command, [command])
  await run('dependency-licenses', ['licenses', 'list', '--prod', '--json'])
  await run('dependency-audit', ['audit', '--prod', '--audit-level', 'high', '--json'])
  await run('performance-benchmark', ['benchmark:quality'])
  if (report.checks.find((check) => check.name === 'compile')?.status !== 'PASS')
    throw new Error('A fresh compiled application is required for runtime checks')
  await run('core-e2e', [
    'exec',
    'playwright',
    'test',
    'e2e/universal-sessions.spec.ts',
    'e2e/project-intelligence.spec.ts',
    'e2e/first-message.spec.ts',
    'e2e/production-boundary.spec.ts',
    'e2e/quality-performance.spec.ts'
  ])
  if (await run('compile-nomascot', ['compile:nomascot'])) {
    await run('nomascot-e2e', ['exec', 'playwright', 'test', 'e2e/nomascot.spec.ts'], {
      PI_HARNESS_E2E_VARIANT: 'nomascot'
    })
  }
  if (packageRequested) {
    const command =
      process.platform === 'darwin'
        ? process.arch === 'arm64'
          ? 'build:mac'
          : 'build:mac:intel'
        : process.platform === 'win32'
          ? 'build:win'
          : 'build:linux'
    if (!(await run('package', [command])))
      throw new Error('Packaging failed; no stale executable will be tested')
    let relative =
      process.platform === 'darwin'
        ? path.join(
            'release',
            process.arch === 'arm64' ? 'mac-arm64' : 'mac',
            'Pi-Harness.app',
            'Contents',
            'MacOS',
            'Pi-Harness'
          )
        : process.platform === 'win32'
          ? path.join('release', 'win-unpacked', 'Pi-Harness.exe')
          : path.join('release', 'linux-unpacked', 'pi-harness')
    if (process.platform === 'darwin') {
      const metadata = await fs.readFile(path.join(root, 'release', 'latest-mac.yml'), 'utf8')
      const payload = metadata.match(/^\s*- url: (.+\.zip)\s*$/m)?.[1]
      if (!payload || path.basename(payload) !== payload)
        throw new Error('The native updater ZIP is missing')
      stagedPackage = path.join(output, 'packaged-execution')
      await fs.mkdir(stagedPackage, { recursive: true })
      await exec('/usr/bin/ditto', ['-x', '-k', path.join(root, 'release', payload), stagedPackage])
      relative = path.relative(
        root,
        path.join(stagedPackage, 'Pi-Harness.app', 'Contents', 'MacOS', 'Pi-Harness')
      )
    }
    const executable = path.join(root, relative)
    if (!(await fs.stat(executable)).isFile()) throw new Error('Packaged executable is missing')
    const packageEnvironment = {
      PI_HARNESS_E2E_EXECUTABLE: executable,
      PI_HARNESS_EXPECTED_ARCH: process.arch,
      PI_HARNESS_EXPECTED_PLATFORM: process.platform
    }
    const integrity = await run(
      'artifact-integrity',
      ['exec', 'node', 'scripts/validate-artifacts.mjs'],
      packageEnvironment
    )
    const passed = await run(
      'packaged-e2e',
      [
        'exec',
        'playwright',
        'test',
        'e2e/production-boundary.spec.ts',
        'e2e/first-message.spec.ts',
        'e2e/pi-sdk-upgrade.spec.ts'
      ],
      packageEnvironment
    )
    report.platformVerification[`${process.platform}-${process.arch}`] =
      passed && integrity ? 'PASS' : 'FAIL'
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
} finally {
  if (stagedPackage) await fs.rm(stagedPackage, { recursive: true, force: true })
  const stable = (await sourceFingerprint()) === report.sourceDigest
  report.checks.push({
    name: 'source-stability',
    status: stable ? 'PASS' : 'FAIL',
    required: true,
    exitCode: stable ? 0 : 1
  })
  if (!stable) process.exitCode = 1
  for (const platform of ['darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-x64'])
    report.platformVerification[platform] ??= 'NOT_RUN'
  // Native executable smoke tests do not stand in for installation or upgrade
  // evidence. Keep these requirements blocked until dedicated runners exist.
  for (const name of ['os-installer', 'installed-profile-upgrade'])
    report.checks.push({ name, status: 'NOT_RUN', required: true })
  for (const name of ['signing', 'notarization', 'updater-end-to-end'])
    report.checks.push({ name, status: 'NOT_RUN', required: false })
  if (report.checks.some((check) => check.required && check.status !== 'PASS')) process.exitCode = 1
  report.readiness =
    report.checks.filter((check) => check.required).every((check) => check.status === 'PASS') &&
    Object.values(report.platformVerification).every((status) => status === 'PASS')
      ? 'READY'
      : 'NOT_READY'
  await save()
}

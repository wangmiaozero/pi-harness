import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  root,
  assetNames,
  metadataName,
  validateMetadata,
  variants,
  digest,
  channel
} from './policy.mjs'
import { verifyDistribution, runtimeLayout, catalog } from '../../src/main/runtime/distribution.mjs'
import { binaryIdentity } from '../../src/main/runtime/binary-identity.mjs'
import { verifyMacBundle } from './after-sign.mjs'
import { sourceDigest } from './source-digest.mjs'
const exec = promisify(execFile)
const platform = `${process.platform}-${process.arch}`
if (process.env.PI_HARNESS_EXPECTED_ARCH && process.env.PI_HARNESS_EXPECTED_ARCH !== process.arch)
  throw new Error('Native runner architecture mismatch')
if (channel !== 'community')
  throw new Error('Verified release credentials and validation must be configured separately')
const version = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version
const output = path.join(root, 'out/community-packages', platform)
const evidenceDirectory = path.join(root, 'out/community-validation', platform)
await fs.mkdir(output, { recursive: true })
await fs.mkdir(evidenceDirectory, { recursive: true })
const revision = (await exec('git', ['rev-parse', 'HEAD'])).stdout.trim()
const report = {
  schemaVersion: 1,
  platform,
  version,
  revision,
  sourceDigest: await sourceDigest(root),
  sourceStable: false,
  channel,
  native: true,
  variants: {},
  readiness: 'NOT_READY'
}
async function command(name, args, env = {}) {
  const pnpm = process.env.npm_execpath
  if (!pnpm) throw new Error('Run this script via pnpm release:package')
  const javascript = /\.[cm]?js$/.test(pnpm)
  const windowsShim = process.platform === 'win32' && /\.(cmd|bat)$/i.test(pnpm)
  const runner = javascript
    ? process.execPath
    : windowsShim
      ? process.env.ComSpec || 'cmd.exe'
      : pnpm
  const arguments_ = javascript
    ? [pnpm, ...args]
    : windowsShim
      ? ['/d', '/s', '/c', pnpm, ...args]
      : args
  const log = await fs.open(path.join(evidenceDirectory, `${name}.log`), 'w')
  const code = await new Promise((resolve) => {
    const child = spawn(runner, arguments_, {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: ['ignore', log.fd, log.fd]
    })
    child.once('error', () => resolve(-1))
    child.once('close', (code) => resolve(code))
  })
  await log.close()
  if (code !== 0)
    throw new Error(
      `${name} failed (${code}); see ${path.relative(root, evidenceDirectory)}/${name}.log`
    )
  process.stdout.write(`${name}: PASS\n`)
}
async function stageInstaller(directory, names, temporary) {
  if (process.platform === 'darwin') {
    const mount = path.join(temporary, 'mount')
    await fs.mkdir(mount)
    await exec('/usr/bin/hdiutil', [
      'attach',
      '-readonly',
      '-nobrowse',
      '-mountpoint',
      mount,
      path.join(directory, names[0])
    ])
    const installed = path.join(temporary, 'Applications', 'Pi-Harness.app')
    try {
      await fs.mkdir(path.dirname(installed), { recursive: true })
      await exec('/usr/bin/ditto', [path.join(mount, 'Pi-Harness.app'), installed])
    } finally {
      await exec('/usr/bin/hdiutil', ['detach', mount])
    }
    await verifyMacBundle(installed, process.arch)
    const zip = path.join(temporary, 'zip')
    await fs.mkdir(zip)
    await exec('/usr/bin/ditto', ['-x', '-k', path.join(directory, names[1]), zip])
    await verifyMacBundle(path.join(zip, 'Pi-Harness.app'), process.arch)
    return path.join(installed, 'Contents/MacOS/Pi-Harness')
  }
  if (process.platform === 'win32') {
    if (
      process.env.GITHUB_ACTIONS !== 'true' &&
      process.env.PI_HARNESS_DISPOSABLE_INSTALL_TEST !== '1'
    )
      throw new Error(
        'NSIS installation tests require a disposable runner; use build:win for local packaging'
      )
    // NSIS /D must be last; the destination is an isolated absolute directory.
    const installed = path.join(temporary, 'installed')
    // Wait for the NSIS process tree, including any installer handoff.
    await exec(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "$ErrorActionPreference='Stop'; $p=Start-Process -FilePath $env:PI_HARNESS_VALIDATION_INSTALLER -ArgumentList @('/S','/currentuser',('/D='+$env:PI_HARNESS_VALIDATION_TARGET)) -Wait -PassThru; exit $p.ExitCode"
      ],
      {
        timeout: 300_000,
        env: {
          ...process.env,
          PI_HARNESS_VALIDATION_INSTALLER: path.join(directory, names[0]),
          PI_HARNESS_VALIDATION_TARGET: installed
        }
      }
    )
    const executable = path.join(installed, 'Pi-Harness.exe')
    await fs.access(executable)
    return executable
  }
  const appimage = path.join(directory, names[0])
  await fs.chmod(appimage, 0o755)
  await exec(appimage, ['--appimage-extract'], {
    cwd: temporary,
    timeout: 180_000,
    maxBuffer: 16 * 1024 * 1024
  })
  return path.join(temporary, 'squashfs-root', 'pi-harness')
}
try {
  await command('runtime-prepare', ['runtime:prepare'])
  await command('runtime-tests', ['test:runtime'])
  for (const variant of variants) {
    const directory = path.join(root, 'release', ...(variant === 'nomascot' ? ['nomascot'] : []))
    const names = assetNames(version, platform, variant)
    const metadata = metadataName(platform, variant)
    // Remove only this target's expected files; stale artifacts cannot satisfy a failed build.
    for (const name of [...names, ...names.map((name) => `${name}.blockmap`), metadata])
      await fs.rm(path.join(directory, name), { force: true })
    await command(`compile-${variant}`, [variant === 'standard' ? 'compile' : 'compile:nomascot'])
    const target =
      process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux'
    const args = [
      'exec',
      'electron-builder',
      '--publish',
      'never',
      `--${target}`,
      `--${process.arch}`
    ]
    if (variant === 'nomascot') args.push('--config', 'electron-builder.nomascot.yml')
    if (process.platform === 'win32' && process.arch === 'arm64')
      args.push(
        `-c.win.artifactName=Pi-Harness-Setup-\${version}-arm64${variant === 'nomascot' ? '-nomascot' : ''}.\${ext}`
      )
    await command(`package-${variant}`, args, { CSC_IDENTITY_AUTO_DISCOVERY: 'false' })
    await validateMetadata(directory, metadata, version, names)
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-community-install-'))
    try {
      const executable = await stageInstaller(directory, names, temporary)
      const identity = await binaryIdentity(executable)
      if (identity?.platform !== process.platform || identity.arch !== process.arch)
        throw new Error('Installed Electron architecture mismatch')
      const resources =
        process.platform === 'darwin'
          ? path.resolve(path.dirname(executable), '../Resources')
          : path.join(path.dirname(executable), 'resources')
      for (const kind of ['pi', 'node']) {
        const runtime = path.join(resources, 'runtimes', kind)
        await verifyDistribution(runtime, kind, process.platform, process.arch)
        const layout = runtimeLayout(kind, process.platform)
        const file = path.join(runtime, layout.executable)
        const env = { ...process.env, PATH: path.dirname(file), ELECTRON_RUN_AS_NODE: undefined }
        const result = await exec(file, ['--version'], { env, timeout: 30_000 })
        if (!result.stdout.includes(catalog[kind].version))
          throw new Error('Installed runtime version mismatch')
        if (kind === 'node')
          for (const tool of ['npm', 'npx']) {
            const result = await exec(file, [path.join(runtime, layout[tool]), '--version'], {
              env,
              timeout: 30_000
            })
            if (result.stdout.trim() !== catalog.node.npmVersion)
              throw new Error('Installed npm/npx mismatch')
          }
      }
      const env = {
        PI_HARNESS_E2E_EXECUTABLE: executable,
        PI_HARNESS_E2E_AGENT_MODE: 'rpc',
        PI_HARNESS_E2E_EMPTY_PATH: '1',
        PI_HARNESS_E2E_VARIANT: variant,
        PLAYWRIGHT_JSON_OUTPUT_FILE: path.join(evidenceDirectory, `e2e-${variant}.json`)
      }
      await command(`resources-${variant}`, ['exec', 'node', 'scripts/validate-artifacts.mjs'], env)
      await command(
        `installed-e2e-${variant}`,
        [
          'exec',
          'playwright',
          'test',
          'e2e/dual-runtime.spec.ts',
          'e2e/first-message.spec.ts',
          'e2e/pi-native-mcp.spec.ts',
          'e2e/runtime-compatibility.spec.ts',
          'e2e/release-session.spec.ts',
          ...(variant === 'nomascot' ? ['e2e/nomascot.spec.ts'] : []),
          '--reporter=list,json'
        ],
        env
      )
      const results = JSON.parse(await fs.readFile(env.PLAYWRIGHT_JSON_OUTPUT_FILE, 'utf8'))
      if (
        !results.stats.expected ||
        results.stats.unexpected ||
        results.stats.skipped ||
        results.stats.flaky
      )
        throw new Error('Required installed tests did not all pass without skips')
      const artifacts = []
      for (const name of names) {
        const file = path.join(directory, name)
        artifacts.push({ file: name, size: (await fs.stat(file)).size, sha256: await digest(file) })
        await fs.copyFile(file, path.join(output, name))
        if (await fs.stat(`${file}.blockmap`).catch(() => null))
          await fs.copyFile(`${file}.blockmap`, path.join(output, `${name}.blockmap`))
      }
      // Metadata remains CI evidence until automatic installation is validated.
      await fs.copyFile(path.join(directory, metadata), path.join(evidenceDirectory, metadata))
      report.variants[variant] = {
        build: 'PASS',
        integrity: 'PASS',
        runtime: 'PASS',
        installer: 'PASS',
        e2e: 'PASS',
        sessionRestart: 'PASS',
        tests: results.stats.expected,
        updateMode: 'manual',
        artifacts
      }
    } finally {
      await fs.rm(temporary, { recursive: true, force: true })
    }
  }
  report.readiness = 'READY'
} finally {
  report.sourceStable = report.sourceDigest === (await sourceDigest(root))
  if (!report.sourceStable) report.readiness = 'NOT_READY'
  await fs.writeFile(path.join(output, 'evidence.json'), JSON.stringify(report, null, 2) + '\n')
  if (!report.sourceStable) throw new Error('Source changed during native package validation')
}

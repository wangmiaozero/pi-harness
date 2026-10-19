/** Native, disposable manual-upgrade validation. Never publishes or enables auto-install. */
import fs from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import { createReadStream } from 'node:fs'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { build, Platform, Arch } from 'electron-builder'
import { root, platforms, variants, assetNames, digest } from './policy.mjs'
import { sourceDigest } from './source-digest.mjs'
import { verifyMacBundle } from './after-sign.mjs'
import { cleanUnpackedMac } from '../clean-unpacked-mac.mjs'
const exec = promisify(execFile)
const target = `${process.platform}-${process.arch}`
if (
  process.platform === 'win32' &&
  process.env.GITHUB_ACTIONS !== 'true' &&
  process.env.PI_HARNESS_DISPOSABLE_INSTALL_TEST !== '1'
)
  throw new Error('Windows upgrade tests require a disposable runner')
const output = path.join(root, 'out/update-validation', target)
await fs.mkdir(output, { recursive: true })
const source = await sourceDigest(root)
const { version: fromVersion } = JSON.parse(
  await fs.readFile(path.join(root, 'package.json'), 'utf8')
)
const numbers = fromVersion.split('.').map(Number)
numbers[2]++
const toVersion = numbers.join('.')
const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const keyId = 'ephemeral-native-upgrade'
const trustFile = path.join(output, 'public-test-trust.json')
await fs.writeFile(
  trustFile,
  JSON.stringify({
    schemaVersion: 1,
    keys: [{ keyId, publicKey: publicKey.export({ type: 'spki', format: 'pem' }), revoked: false }]
  }) + '\n'
)
const report = {
  schemaVersion: 1,
  platform: process.platform,
  arch: process.arch,
  fromVersion,
  toVersion,
  sourceDigest: source,
  native: true,
  readiness: 'NOT_READY',
  autoInstall: 'NOT_VERIFIED',
  gatekeeper: 'NOT_VERIFIED',
  smartScreen: 'NOT_VERIFIED',
  variants: {}
}
async function command(name, args, environment = {}) {
  const pnpm = process.env.npm_execpath
  if (!pnpm) throw new Error('Use pnpm release:test-upgrade')
  const javascript = /\.[cm]?js$/.test(pnpm)
  const shim = process.platform === 'win32' && /\.(cmd|bat)$/i.test(pnpm)
  const executable = javascript ? process.execPath : shim ? process.env.ComSpec || 'cmd.exe' : pnpm
  const argv = javascript ? [pnpm, ...args] : shim ? ['/d', '/s', '/c', pnpm, ...args] : args
  const log = await fs.open(path.join(output, `${name}.log`), 'w')
  try {
    const code = await new Promise((resolve) => {
      const child = spawn(executable, argv, {
        cwd: root,
        env: { ...process.env, ...environment },
        stdio: ['ignore', log.fd, log.fd]
      })
      child.once('error', () => resolve(-1))
      child.once('close', resolve)
    })
    if (code !== 0) throw new Error(`${name} failed; inspect its local validation log`)
  } finally {
    await log.close()
  }
}
async function install(directory, destination, version, variant) {
  const names = assetNames(version, target, variant)
  if (process.platform === 'darwin') {
    await fs.mkdir(destination, { recursive: true })
    await exec('/usr/bin/ditto', ['-x', '-k', path.join(directory, names[1]), destination])
    const app = path.join(destination, 'Pi-Harness.app')
    await verifyMacBundle(app, process.arch)
    return path.join(app, 'Contents/MacOS/Pi-Harness')
  }
  if (process.platform === 'win32') {
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
          PI_HARNESS_VALIDATION_TARGET: destination
        }
      }
    )
    return path.join(destination, 'Pi-Harness.exe')
  }
  await fs.mkdir(destination, { recursive: true })
  const appimage = path.join(destination, 'Pi-Harness.AppImage')
  await fs.copyFile(path.join(directory, names[0]), appimage)
  await fs.chmod(appimage, 0o755)
  return appimage
}
try {
  for (const variant of variants) {
    await command(
      `compile-${variant}`,
      [
        'exec',
        'electron-vite',
        'build',
        '--mode',
        variant === 'standard' ? 'update-e2e' : 'update-e2e-nomascot'
      ],
      { PI_HARNESS_NATIVE_UPDATE_TEST: '1', PI_HARNESS_UPDATE_TEST_TRUST: trustFile }
    )
    const packages = {}
    for (const version of [fromVersion, toVersion]) {
      const directory = path.join(output, variant, version)
      await build({
        projectDir: root,
        targets: (process.platform === 'darwin'
          ? Platform.MAC
          : process.platform === 'win32'
            ? Platform.WINDOWS
            : Platform.LINUX
        ).createTarget(undefined, process.arch === 'arm64' ? Arch.arm64 : Arch.x64),
        publish: 'never',
        config: {
          extends: path.join(
            root,
            variant === 'standard' ? 'electron-builder.yml' : 'electron-builder.nomascot.yml'
          ),
          directories: { output: directory },
          extraMetadata: { version },
          ...(process.platform === 'win32' && process.arch === 'arm64'
            ? {
                win: {
                  artifactName: `Pi-Harness-Setup-\${version}-arm64${variant === 'nomascot' ? '-nomascot' : ''}.\${ext}`
                }
              }
            : {})
        }
      })
      if (process.platform === 'darwin') await cleanUnpackedMac(directory)
      packages[version] = directory
    }
    const directory = packages[toVersion]
    const previewPlatforms = platforms.includes(target) ? [] : [target]
    const artifacts = []
    for (const platform of [...platforms, ...previewPlatforms])
      for (const edition of variants)
        for (const file of assetNames(toVersion, platform, edition)) {
          const actual =
            platform === target && edition === variant ? path.join(directory, file) : null
          artifacts.push({
            file,
            platform: platform.split('-')[0],
            arch: platform.split('-')[1],
            variant: edition,
            size: actual ? (await fs.stat(actual)).size : 1,
            sha256: actual
              ? await digest(actual)
              : createHash('sha256').update('fixture').digest('hex')
          })
        }
    const manifest = Buffer.from(
      JSON.stringify(
        {
          version: toVersion,
          channel: 'community',
          revision: 'native-upgrade-fixture',
          releaseNotes: `Local native ${variant} upgrade fixture ${fromVersion} → ${toVersion}.`,
          ...(previewPlatforms.length ? { previewPlatforms } : {}),
          artifacts
        },
        null,
        2
      ) + '\n'
    )
    const signature = Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        algorithm: 'Ed25519',
        keyId,
        signature: sign(null, manifest, privateKey).toString('base64')
      }) + '\n'
    )
    await fs.writeFile(path.join(output, variant, 'checksums.json'), manifest)
    await fs.writeFile(path.join(output, variant, 'checksums.json.sig'), signature)
    const buffers = new Map([
      [
        'latest.json',
        Buffer.from(JSON.stringify({ tag_name: `v${toVersion}`, draft: false, prerelease: false }))
      ],
      ['checksums.json', manifest],
      ['checksums.json.sig', signature]
    ])
    const server = http.createServer(async (request, response) => {
      const name = new URL(request.url, 'http://localhost').pathname.slice(1)
      if (name === 'squirrel') {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(
          JSON.stringify({
            url: `http://127.0.0.1:${server.address().port}/${assetNames(toVersion, target, variant)[1]}`,
            name: toVersion,
            notes: 'Native Ad-hoc compatibility probe',
            pub_date: new Date().toISOString()
          })
        )
        return
      }
      if (buffers.has(name)) {
        response.writeHead(200, { 'content-length': buffers.get(name).length })
        response.end(buffers.get(name))
        return
      }
      if (!assetNames(toVersion, target, variant).includes(name)) {
        response.writeHead(404)
        response.end()
        return
      }
      const file = path.join(directory, name),
        size = (await fs.stat(file)).size
      const range = request.headers.range?.match(/^bytes=(\d+)-$/),
        start = range ? Number(range[1]) : 0
      if (start >= size) {
        response.writeHead(416)
        response.end()
        return
      }
      response.writeHead(range ? 206 : 200, {
        'content-type': 'application/octet-stream',
        'content-length': size - start,
        ...(range ? { 'content-range': `bytes ${start}-${size - 1}/${size}` } : {})
      })
      const stream = createReadStream(file, { start, highWaterMark: 256 * 1024 })
      response.once('close', () => stream.destroy())
      try {
        for await (const chunk of stream) {
          if (response.destroyed) break
          if (!response.write(chunk))
            await new Promise((resolve) => response.once('drain', resolve))
          await new Promise((resolve) => setTimeout(resolve, 2))
        }
      } catch {
        // Cancellation closes the local fixture stream.
      } finally {
        response.end()
      }
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const installed = path.join(output, variant, 'installed')
    await fs.rm(installed, { recursive: true, force: true })
    await fs.rm(path.join(output, variant, 'next'), { recursive: true, force: true })
    const executable = await install(packages[fromVersion], installed, fromVersion, variant)
    // NSIS must see the old installation's registry entry when upgrading. Do not
    // preinstall the new Windows package into a second path with the same app id.
    const nextExecutable =
      process.platform === 'darwin'
        ? await install(directory, path.join(output, variant, 'next'), toVersion, variant)
        : executable
    try {
      await command(
        `upgrade-${variant}`,
        ['exec', 'playwright', 'test', 'e2e/update-upgrade.spec.ts', '--reporter=list'],
        {
          PI_HARNESS_E2E_EXECUTABLE: executable,
          PI_HARNESS_E2E_VARIANT: variant,
          PI_HARNESS_E2E_AGENT_MODE: 'rpc',
          PI_HARNESS_UPDATE_TEST_NEW_EXECUTABLE: nextExecutable,
          PI_HARNESS_UPDATE_TEST_NEW_INSTALLER: path.join(
            directory,
            assetNames(toVersion, target, variant)[0]
          ),
          PI_HARNESS_UPDATE_TEST_TRUST_FILE: trustFile,
          PI_HARNESS_UPDATE_TEST_FROM: fromVersion,
          PI_HARNESS_UPDATE_TEST_TO: toVersion,
          PI_HARNESS_UPDATE_FIXTURE_URL: `http://127.0.0.1:${server.address().port}`,
          PI_HARNESS_UPDATE_TEST_RESULT: path.join(output, `upgrade-${variant}.json`),
          APPIMAGE_EXTRACT_AND_RUN: '1'
        }
      )
      report.variants[variant] = JSON.parse(
        await fs.readFile(path.join(output, `upgrade-${variant}.json`), 'utf8')
      )
    } finally {
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    }
  }
  report.readiness = 'DOWNLOAD_VERIFIED'
} finally {
  report.sourceStable = source === (await sourceDigest(root))
  if (!report.sourceStable) {
    report.readiness = 'NOT_READY'
    process.exitCode = 1
  }
  await fs.writeFile(path.join(output, 'evidence.json'), JSON.stringify(report, null, 2) + '\n')
}

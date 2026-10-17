import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import semver from 'semver'
import { parse as parseYaml } from 'yaml'
import {
  npmStable,
  githubStable,
  nodeLts,
  PI_SDK_PACKAGES
} from '../../src/main/runtime/version-sources.mjs'
import { catalog, verifyDistribution, runtimeLayout } from '../../src/main/runtime/distribution.mjs'
import { verifySdkMatrix } from '../runtime/verify-sdk.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
const lock = parseYaml(await fs.readFile(path.join(root, 'pnpm-lock.yaml'), 'utf8'))
const offline = process.argv.includes('--offline')
const runtimeOnly = process.argv.includes('--runtime')
const dependenciesOnly = process.argv.includes('--dependencies')
const nativeOnly = process.argv.includes('--native')
const report = {
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  appVersion: pkg.version,
  dependencies: [],
  runtimes: {},
  errors: []
}
for (const group of ['dependencies', 'devDependencies'])
  for (const [name, specifier] of Object.entries(pkg[group] ?? {}))
    if (lock.importers?.['.']?.[group]?.[name]?.specifier !== specifier)
      report.errors.push(`Manifest and lockfile specifiers differ: ${name}`)
if (!runtimeOnly) {
  const dependencies = Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })
  for (let offset = 0; offset < dependencies.length; offset += 6)
    await Promise.all(
      dependencies.slice(offset, offset + 6).map(async ([name, declared]) => {
        let installed = null
        try {
          installed = JSON.parse(
            await fs.readFile(path.join(root, 'node_modules', name, 'package.json'), 'utf8')
          ).version
        } catch {
          /* Missing packages remain unknown. */
        }
        const result = {
          name,
          declared,
          installed,
          latestStable: null,
          updateAvailable: null,
          breaking: null,
          engines: {},
          peers: {},
          error: null
        }
        if (!offline) {
          try {
            const latest = await npmStable(name)
            result.latestStable = latest.version
            result.engines = latest.engines
            result.peers = latest.peers
            result.updateAvailable = installed ? semver.gt(latest.version, installed) : null
            result.breaking = installed
              ? semver.major(latest.version) !== semver.major(installed) ||
                (semver.major(installed) === 0 &&
                  semver.minor(latest.version) !== semver.minor(installed))
              : null
          } catch (error) {
            result.error = error.message
          }
        }
        report.dependencies.push(result)
      })
    )
  report.dependencies.sort((a, b) => a.name.localeCompare(b.name))
}
if (!dependenciesOnly) {
  try {
    report.runtimes.sdk = { aligned: true, packages: await verifySdkMatrix(root) }
  } catch (error) {
    report.errors.push(error.message)
  }
  report.runtimes.catalog = {
    pi: catalog.pi.version,
    node: catalog.node.version,
    npm: catalog.node.npmVersion
  }
  if (!offline) {
    const checks = [
      ['pi', () => githubStable('earendil-works/pi')],
      ['nodeLts', () => nodeLts()],
      ...PI_SDK_PACKAGES.map((name) => [name, async () => (await npmStable(name)).version])
    ]
    report.runtimes.upstream = Object.fromEntries(
      await Promise.all(
        checks.map(async ([name, query]) => {
          try {
            return [name, { version: await query(), error: null }]
          } catch (error) {
            return [name, { version: null, error: error.message }]
          }
        })
      )
    )
  }
  report.runtimes.resources = []
  for (const target of Object.keys(catalog.pi.assets)) {
    const [platform, arch] = target.split('-')
    if (nativeOnly && (platform !== process.platform || arch !== process.arch)) continue
    for (const kind of ['pi', 'node']) {
      const directory = path.join(root, 'resources/runtimes', target, kind)
      const item = {
        target,
        kind,
        integrity: 'NOT_VERIFIED',
        execution: 'NOT_VERIFIED',
        version: null
      }
      try {
        await verifyDistribution(directory, kind, platform, arch)
        item.integrity = 'PASS'
        if (platform === process.platform && arch === process.arch) {
          const layout = runtimeLayout(kind, platform)
          const executable = path.join(directory, layout.executable)
          const env = {
            ...process.env,
            PATH: path.dirname(executable),
            NODE_OPTIONS: undefined,
            ELECTRON_RUN_AS_NODE: undefined
          }
          const { stdout } = await promisify(execFile)(executable, ['--version'], {
            env,
            timeout: 30_000
          })
          item.version = semver.coerce(stdout.trim())?.version ?? null
          if (item.version !== catalog[kind].version)
            throw new Error('Runtime executable version differs from catalog')
          item.execution = 'PASS'
        }
      } catch (error) {
        item.error = error.message
        report.errors.push(`${target}/${kind}: ${error.message}`)
      }
      report.runtimes.resources.push(item)
    }
  }
}
if (process.argv.includes('--report')) {
  const output = path.join(root, 'out/upgrade')
  await fs.mkdir(output, { recursive: true })
  await fs.writeFile(path.join(output, 'versions.json'), JSON.stringify(report, null, 2) + '\n')
  await fs.writeFile(
    path.join(output, 'versions.md'),
    [
      '# Dependency and runtime audit',
      '',
      `Checked: ${report.checkedAt}`,
      '',
      '| Package | Installed | Latest stable | Update | Breaking |',
      '| --- | --- | --- | --- | --- |',
      ...report.dependencies.map(
        (row) =>
          `| ${row.name} | ${row.installed ?? 'unknown'} | ${row.latestStable ?? 'unknown'} | ${row.updateAvailable ?? 'unknown'} | ${row.breaking ?? 'unknown'} |`
      ),
      '',
      '## Runtime evidence',
      '',
      '```json',
      JSON.stringify(report.runtimes, null, 2),
      '```',
      '',
      'Foreign-platform integrity verification is static evidence, not native execution or installer validation.',
      '',
      ...report.errors.map((error) => `- ${error}`)
    ].join('\n') + '\n'
  )
}
process.stdout.write(JSON.stringify(report, null, 2) + '\n')
if (report.errors.length) process.exitCode = 1

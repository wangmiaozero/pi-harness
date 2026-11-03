import fs from 'node:fs/promises'
import path from 'node:path'
import {
  root,
  platforms,
  variants,
  assetNames,
  digest,
  channel,
  changelogSection
} from './policy.mjs'
import { renderReleaseNotes } from './release-notes.mjs'
export async function collect(input, output, version, revision, releaseNotes = '') {
  const artifacts = []
  const reports = []
  let expectedSourceDigest
  for (const platform of platforms) {
    const directory = path.join(input, `packages-${platform}`)
    const report = JSON.parse(await fs.readFile(path.join(directory, 'evidence.json'), 'utf8'))
    if (
      report.schemaVersion !== 1 ||
      report.platform !== platform ||
      report.version !== version ||
      report.revision !== revision ||
      report.channel !== channel ||
      report.native !== true ||
      report.readiness !== 'READY'
    )
      throw new Error(`Missing matching native release evidence: ${platform}`)
    expectedSourceDigest ??= report.sourceDigest
    if (
      !report.sourceStable ||
      !/^[a-f0-9]{64}$/.test(report.sourceDigest) ||
      report.sourceDigest !== expectedSourceDigest
    )
      throw new Error('Native reports describe different or unstable source trees')
    const allowed = new Set(['evidence.json'])
    for (const variant of variants) {
      const evidence = report.variants[variant]
      for (const check of ['build', 'integrity', 'runtime', 'installer', 'e2e', 'sessionRestart'])
        if (evidence?.[check] !== 'PASS')
          throw new Error(`Required ${platform}/${variant}/${check} did not pass`)
      if (
        !Number.isInteger(evidence.tests) ||
        evidence.tests < 7 ||
        evidence.updateMode !== 'manual'
      )
        throw new Error('Installed test or update policy evidence is incomplete')
      const expected = assetNames(version, platform, variant)
      if (evidence.artifacts?.length !== expected.length)
        throw new Error('Artifact evidence is incomplete')
      for (const name of expected) {
        const file = path.join(directory, name)
        const evidenceFile = evidence.artifacts.find((item) => item.file === name)
        const size = (await fs.stat(file)).size
        const sha256 = await digest(file)
        if (!size || evidenceFile?.sha256 !== sha256 || evidenceFile?.size !== size)
          throw new Error(`Artifact transport integrity failed: ${name}`)
        allowed.add(name)
        artifacts.push({
          file: name,
          size,
          sha256,
          platform: platform.split('-')[0],
          arch: platform.split('-')[1],
          variant
        })
        const blockmap = `${name}.blockmap`
        if (await fs.stat(path.join(directory, blockmap)).catch(() => null)) allowed.add(blockmap)
      }
    }
    for (const name of await fs.readdir(directory)) {
      if (!allowed.has(name)) throw new Error(`Unexpected release file: ${name}`)
      if (name === 'evidence.json') continue
      await fs.mkdir(output, { recursive: true })
      await fs.copyFile(
        path.join(directory, name),
        path.join(output, name),
        fs.constants.COPYFILE_EXCL
      )
    }
    reports.push(report)
  }
  const uploaded = []
  for (const file of (await fs.readdir(output)).sort())
    uploaded.push(`${await digest(path.join(output, file))}  ${file}`)
  await fs.writeFile(path.join(output, 'SHA256SUMS'), uploaded.join('\n') + '\n', { flag: 'wx' })
  await fs.writeFile(
    path.join(output, 'checksums.json'),
    JSON.stringify({ version, channel, revision, artifacts, releaseNotes }, null, 2) + '\n',
    { flag: 'wx' }
  )
  return reports
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const { version } = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
  const notes =
    process.env.GITHUB_EVENT_NAME === 'workflow_dispatch'
      ? `# Build Preview ${version}\n\nThis is an unpublished test build from ${process.env.GITHUB_SHA}.`
      : changelogSection(await fs.readFile(path.join(root, 'CHANGELOG.md'), 'utf8'), version)
  const reports = await collect(
    path.resolve('package-artifacts'),
    path.resolve('release-artifacts'),
    version,
    process.env.GITHUB_SHA,
    notes
  )
  await fs.writeFile(
    'release-notes.md',
    renderReleaseNotes(
      await fs.readFile(path.join(root, 'CHANGELOG.md'), 'utf8'),
      version,
      process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' ? process.env.GITHUB_SHA : undefined
    )
  )
  await fs.writeFile(
    'release-readiness.json',
    JSON.stringify({ readiness: 'READY', channel, version, reports }, null, 2) + '\n'
  )
}

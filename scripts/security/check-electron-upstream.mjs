#!/usr/bin/env node
/**
 * Upstream monitor: does any stable Electron release bundle a Node runtime that
 * meets the reviewed security baseline in src/shared/runtime/node-security-policy.json?
 *
 * This is a monitoring aid only. It never modifies the Electron security review
 * record and never grants a PASS. Release readiness still requires the exact
 * version review in electron-security-review.json plus full regression gates
 * (see scripts/security/check-node-runtime.mjs --release).
 *
 * Usage: node scripts/security/check-electron-upstream.mjs [--json]
 * Exit code is always 0 unless the upstream data cannot be fetched or parsed.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import semver from 'semver'
import { nodeSecurityPolicy as policy } from '../../src/shared/runtime/node-security-policy.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const source = 'https://releases.electronjs.org/releases.json'
const json = process.argv.includes('--json')

const installed = await fs
  .readFile(path.join(root, 'node_modules/electron/package.json'), 'utf8')
  .then((text) => JSON.parse(text).version)
  .catch(() => null)

const response = await fetch(source, { redirect: 'error', signal: AbortSignal.timeout(60_000) })
if (!response.ok) throw new Error(`Upstream release index request: ${response.status}`)
const releases = JSON.parse(await response.text())

/** Latest stable (non-prerelease) Electron release per major line. */
const latestStableByMajor = new Map()
for (const release of releases) {
  if (semver.prerelease(release.version)) continue
  const major = semver.major(release.version)
  const current = latestStableByMajor.get(major)
  if (!current || semver.gt(release.version, current.version))
    latestStableByMajor.set(major, release)
}

/** Security assessment of an embedded Node version against the reviewed policy. */
function assessEmbeddedNode(nodeVersion) {
  const major = nodeVersion ? semver.major(nodeVersion) : null
  const line = major !== null ? policy.lines[major] : undefined
  if (!nodeVersion || !line) return { meetsBaseline: false, patchStatus: 'UNKNOWN', baseline: null }
  const meetsBaseline = semver.gte(nodeVersion, line.minimum)
  return {
    meetsBaseline,
    patchStatus: meetsBaseline ? 'FIXED' : 'VULNERABLE',
    baseline: line.minimum
  }
}

const majors = [...latestStableByMajor.keys()].sort((a, b) => a - b)
const relevantMajors = majors.filter(
  (major) => installed === null || major >= semver.major(installed)
)
const candidates = relevantMajors.map((major) => {
  const release = latestStableByMajor.get(major)
  const assessment = assessEmbeddedNode(release.node)
  return {
    electron: release.version,
    electronMajor: major,
    releasedAt: release.date,
    embeddedNode: release.node ?? null,
    chromium: release.chrome ?? null,
    ...assessment
  }
})

const readyCandidate = candidates
  .filter((candidate) => candidate.meetsBaseline)
  .filter((candidate) => installed === null || semver.gte(candidate.electron, installed))
  .sort((a, b) => semver.compare(a.electron, b.electron))[0]

const installedAssessment = assessEmbeddedNode(
  releases.find((release) => release.version === installed)?.node ?? null
)
const report = {
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  source,
  advisory: policy.source,
  baselineNote:
    'Baseline is derived per embedded Node major from node-security-policy.json; it reflects the reviewed advisory only.',
  installedElectron: installed,
  installedEmbeddedNodeStatus: installedAssessment.patchStatus,
  candidates,
  ready: Boolean(readyCandidate),
  readyElectron: readyCandidate?.electron ?? null
}

if (json) {
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')
} else {
  const installedLine = installed
    ? `Installed Electron: ${installed}\n`
    : 'Installed Electron: not found (node_modules/electron missing)\n'
  const rows = candidates.map((candidate) => ({
    electron: candidate.electron,
    node: candidate.embeddedNode ?? 'unknown',
    baseline: candidate.baseline ?? 'unknown',
    status: candidate.meetsBaseline ? 'MEETS BASELINE' : 'below baseline'
  }))
  const width = (header, values) => Math.max(header.length, ...values.map((value) => value.length))
  const columns = [
    ['Electron', rows.map((row) => row.electron)],
    ['Embedded Node', rows.map((row) => row.node)],
    ['Baseline', rows.map((row) => row.baseline)],
    ['Status', rows.map((row) => row.status)]
  ]
  const widths = columns.map(([header, values]) => width(header, values))
  const line = widths.map((w) => '-'.repeat(w + 2)).join('+')
  const format = (cells) => cells.map((cell, index) => ` ${cell.padEnd(widths[index])} `).join('|')
  process.stdout.write(
    [
      `Advisory: ${policy.source}`,
      `Source: ${source}`,
      installedLine,
      'Latest stable Electron per major line:',
      format(columns.map(([header]) => header)),
      line,
      ...rows.map((row) => format(Object.values(row)))
    ].join('\n') + '\n'
  )
  if (readyCandidate)
    process.stdout.write(
      `\nREADY: Electron ${readyCandidate.electron} (embedded Node ${readyCandidate.embeddedNode}) meets the ${readyCandidate.baseline} baseline.\n` +
        'Next: upgrade Electron, probe the actual binary, record the exact-version review in src/shared/runtime/electron-security-review.json, then run the full regression and release gates.\n'
    )
  else
    process.stdout.write(
      '\nWAITING: no stable Electron release bundles a Node runtime at the required baseline yet.\n' +
        'Do not record a review entry and do not weaken the release gate; re-run this check later.\n'
    )
}

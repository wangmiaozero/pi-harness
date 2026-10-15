import fs from 'node:fs/promises'
import path from 'node:path'

const reports = process.argv.slice(2)
const requiredPlatforms = ['darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-x64']
const requiredChecks = [
  'typecheck',
  'lint',
  'test',
  'compile',
  'compile-nomascot',
  'nomascot-e2e',
  'source-stability',
  'dependency-licenses',
  'dependency-audit',
  'performance-benchmark',
  'core-e2e',
  'package',
  'artifact-integrity',
  'packaged-e2e',
  'os-installer',
  'installed-profile-upgrade'
]
const verification = Object.fromEntries(requiredPlatforms.map((platform) => [platform, 'NOT_RUN']))
const errors = []
let version
let sourceDigest
if (!reports.length) errors.push('No native quality reports were supplied')
for (const file of reports) {
  try {
    const report = JSON.parse(await fs.readFile(file, 'utf8'))
    const nativePlatform = `${report.environment.platform}-${report.environment.arch}`
    if (report.schemaVersion !== 1 || !requiredPlatforms.includes(nativePlatform))
      throw new Error('Unknown quality report')
    version ??= report.version
    sourceDigest ??= report.sourceDigest
    if (!/^[a-f0-9]{64}$/.test(report.sourceDigest) || report.sourceDigest !== sourceDigest)
      throw new Error('Reports describe different source trees')
    if (report.version !== version)
      throw new Error('Reports describe different application versions')
    for (const name of requiredChecks) {
      const check = report.checks.find((check) => check.name === name)
      if (!check || check.status !== 'PASS' || check.exitCode !== 0)
        throw new Error(`Required check did not pass: ${name}`)
    }
    if (report.platformVerification[nativePlatform] !== 'PASS')
      throw new Error('Native package execution was not verified')
    verification[nativePlatform] = 'PASS'
  } catch (error) {
    errors.push(`${path.basename(file)}: ${error.message}`)
  }
}
const readiness =
  errors.length === 0 && Object.values(verification).every((status) => status === 'PASS')
    ? 'READY'
    : 'NOT_READY'
process.stdout.write(
  JSON.stringify(
    { schemaVersion: 1, version, readiness, platformVerification: verification, errors },
    null,
    2
  ) + '\n'
)
if (readiness !== 'READY') process.exitCode = 1

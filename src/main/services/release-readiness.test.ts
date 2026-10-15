// @vitest-environment node
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterEach, expect, it } from 'vitest'

const execute = promisify(execFile)
const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0))
    await fs.rm(directory, { recursive: true, force: true })
})
const names = [
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
async function reportFile(platform: string, arch: string, overrides: Record<string, unknown> = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'readiness-fixture-'))
  directories.push(directory)
  const file = path.join(directory, 'report.json')
  await fs.writeFile(
    file,
    JSON.stringify({
      schemaVersion: 1,
      version: '2.0.0',
      sourceDigest: 'a'.repeat(64),
      environment: { platform, arch },
      checks: names.map((name) => ({ name, status: 'PASS', exitCode: 0 })),
      platformVerification: { [`${platform}-${arch}`]: 'PASS' },
      ...overrides
    })
  )
  return file
}
async function readiness(files: string[]) {
  try {
    return {
      success: true,
      data: JSON.parse(
        (await execute(process.execPath, ['scripts/release-readiness.mjs', ...files])).stdout
      )
    }
  } catch (error) {
    return { success: false, data: JSON.parse((error as { stdout: string }).stdout) }
  }
}
it('does not promote a single native platform or repeated reports into cross-platform certification', async () => {
  const file = await reportFile('darwin', 'arm64')
  const result = await readiness([file, file])
  expect(result.success).toBe(false)
  expect(result.data.platformVerification['win32-x64']).toBe('NOT_RUN')
  expect(result.data.readiness).toBe('NOT_READY')
})
it('requires matching source trees and every required command, rather than a reported READY label', async () => {
  const file = await reportFile('darwin', 'arm64', { readiness: 'READY', checks: [] })
  expect((await readiness([file])).success).toBe(false)
  const other = await reportFile('darwin', 'x64', { sourceDigest: 'b'.repeat(64) })
  const result = await readiness([await reportFile('darwin', 'arm64'), other])
  expect(result.success).toBe(false)
  expect(result.data.errors.join('\n')).toContain('different source trees')
})
it('accepts complete matching fixture reports and fails for absent evidence', async () => {
  const files = await Promise.all(
    [
      ['darwin', 'arm64'],
      ['darwin', 'x64'],
      ['win32', 'x64'],
      ['linux', 'x64']
    ].map(([platform, arch]) => reportFile(platform, arch))
  )
  expect((await readiness(files)).data.readiness).toBe('READY')
  expect((await readiness([])).success).toBe(false)
})
it('blocks release when native execution passed but installation or installed-profile upgrades were not run', async () => {
  for (const missing of ['os-installer', 'installed-profile-upgrade']) {
    const file = await reportFile('darwin', 'arm64', {
      checks: names.map((name) => ({
        name,
        status: name === missing ? 'NOT_RUN' : 'PASS',
        exitCode: name === missing ? undefined : 0
      }))
    })
    const result = await readiness([file])
    expect(result.data.readiness).toBe('NOT_READY')
    expect(result.data.errors.join('\n')).toContain(missing)
  }
})

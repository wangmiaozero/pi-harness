import fs from 'node:fs'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

assert.equal(process.platform, 'win32')
assert.equal(process.arch, process.env.PI_HARNESS_EXPECTED_ARCH)
const file = 'src/main/services/storage.test.ts'
const out = 'out/storage-lock-probe'
fs.mkdirSync(out, { recursive: true })
const original = execFileSync('git', ['show', 'c23d18f4df57b346c0c362c58e168c1794095e76:' + file], { encoding: 'utf8' })
const fixed = execFileSync('git', ['show', 'HEAD:' + file], { encoding: 'utf8' })
const mode = process.argv[2]
const delayed = (source) => {
  const marker = '$f = [IO.File]::Open'
  assert.equal(source.split(marker).length, 2)
  return source.replace(marker, 'Start-Sleep -Milliseconds 16000; ' + marker)
}
if (mode === 'original') {
  let source = delayed(original)
  // Ensure the expected timed-out control cannot leave a native owner running.
  const marker = '      try {\n        await new Promise<void>'
  assert(source.includes(marker))
  source = source.replace(marker, '      ;(globalThis as any).__storageLocker = locker\n' + marker)
  source = source.replace('  afterEach(async () => {\n', `  afterEach(async () => {
    const child = (globalThis as any).__storageLocker
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      const closed = once(child, 'close')
      child.kill()
      await closed
    }
    delete (globalThis as any).__storageLocker
`)
  fs.writeFileSync(file, source)
} else if (mode === 'verify-original') {
  assert.notEqual(Number(process.argv[3]), 0)
  const report = JSON.parse(fs.readFileSync(out + '/original.json', 'utf8'))
  const failed = report.testResults.flatMap((suite) => suite.assertionResults).filter((test) => test.status === 'failed')
  assert.equal(report.numFailedTests, 1)
  assert.equal(failed.length, 1)
  assert.match(failed[0].fullName, /real Windows handle that denies file replacement/)
  assert.match(failed[0].failureMessages.join('\n'), /timed out in 15000ms/)
  console.log('Expected original startup control failed at the original 15-second deadline.')
} else if (mode === 'fixed-delayed') {
  fs.writeFileSync(file, delayed(fixed))
} else if (mode === 'restore') {
  fs.writeFileSync(file, fixed)
  const blob = execFileSync('git', ['hash-object', file], { encoding: 'utf8' }).trim()
  const expected = execFileSync('git', ['rev-parse', 'HEAD:' + file], { encoding: 'utf8' }).trim()
  assert.equal(blob, expected)
  fs.writeFileSync(out + '/source.json', JSON.stringify({ platform: process.platform, arch: process.arch, blob, revision: process.env.GITHUB_SHA }, null, 2))
} else {
  throw new Error('Unknown probe stage')
}

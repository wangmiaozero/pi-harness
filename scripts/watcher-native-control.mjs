import fs from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
const file = 'src/main/workspace/workspace-watcher-service.ts'
const fixed = fs.readFileSync(file)
try {
  fs.writeFileSync(file, execFileSync('git', ['show', '66f712342a60fe118224aa3cc8fd6126d11ba0e1:' + file]))
  const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'src/main/workspace/workspace-watcher-service.test.ts', '-t', 'older timestamps'], { encoding: 'utf8' })
  const output = (result.stdout + result.stderr).replace(/\x1b\[[0-9;]*m/g, '')
  process.stdout.write(output)
  if (result.status !== 1 || !output.includes('2 failed') || !output.includes('Number of calls: 0'))
    throw new Error('Old-code negative control did not fail at the expected lost-notification assertions')
  console.log('EXPECTED OLD-CODE FAILURE CONFIRMED')
} finally {
  fs.writeFileSync(file, fixed)
}

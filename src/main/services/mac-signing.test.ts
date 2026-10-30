// @vitest-environment node
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const builder = createRequire(require.resolve('electron-builder'))
const packager = createRequire(builder.resolve('app-builder-lib'))
const signer = packager.resolve('@electron/osx-sign')

it.skipIf(process.platform === 'win32')(
  'enumerates every signing candidate with only 64 file descriptors available',
  async () => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'mac-signing-'))
    const tree = path.join(temporary, 'tree')
    const app = path.join(tree, 'App.app')
    const framework = path.join(app, 'Contents/Frameworks/Helper.framework')
    const helper = path.join(framework, 'Versions/A/Helper')
    const expected = [app, framework, helper]
    const binary = Buffer.from([0, 1, 2, 3, 0, 4, 5, 6])
    try {
      await fs.mkdir(path.dirname(helper), { recursive: true })
      await fs.writeFile(helper, binary)
      await fs.writeFile(path.join(app, 'Contents/stale.cstemp'), binary)
      await fs.writeFile(path.join(app, 'Contents/readme.txt'), 'Plain text resource\n')
      for (let clip = 0; clip < 30; clip++) {
        const directory = path.join(app, `Contents/Resources/petpacks/clip-${clip}`)
        await fs.mkdir(directory, { recursive: true })
        for (let frame = 0; frame < 30; frame++) {
          const file = path.join(directory, `frame-${frame}.webp`)
          await fs.writeFile(file, binary)
          expected.push(file)
        }
      }
      const inventory = path.join(temporary, 'expected.json')
      await fs.writeFile(inventory, JSON.stringify(expected))
      const probe = path.join(temporary, 'probe.cjs')
      await fs.writeFile(
        probe,
        `const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
require(process.argv[2]).walkAsync(process.argv[3]).then((files) => {
  assert.deepEqual(files.sort(), JSON.parse(fs.readFileSync(process.argv[4], 'utf8')).sort());
  assert.equal(fs.existsSync(path.join(process.argv[3], 'App.app/Contents/stale.cstemp')), false);
  console.log(JSON.stringify({ candidates: files.length }));
}).catch((error) => { console.error(error.code || error.message); process.exitCode = 1 });
`
      )
      const { stdout } = await promisify(execFile)(
        '/bin/sh',
        [
          '-c',
          'set -e\nulimit -n 64\nexec "$@"',
          'signing-probe',
          process.execPath,
          probe,
          signer,
          tree,
          inventory
        ],
        { timeout: 10000 }
      )
      expect(JSON.parse(stdout)).toEqual({ candidates: 903 })
    } finally {
      await fs.rm(temporary, { recursive: true, force: true })
    }
  },
  // Real filesystem setup and a child with its own 10s deadline are intentionally bounded.
  15000
)

it('propagates signing inventory filesystem errors', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'mac-signing-missing-'))
  try {
    const { walkAsync } = require(signer) as { walkAsync(root: string): Promise<string[]> }
    await expect(walkAsync(path.join(temporary, 'missing'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  } finally {
    await fs.rm(temporary, { recursive: true, force: true })
  }
})

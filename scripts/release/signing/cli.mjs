import fs from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { generateReleaseKey } from './keys.mjs'
import { signCandidate } from './sign.mjs'
import { verifyCandidate } from '../verify-candidate.mjs'

try {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      dir: { type: 'string' },
      'key-id': { type: 'string' },
      'private-key': { type: 'string' },
      version: { type: 'string' },
      revision: { type: 'string' },
      trust: { type: 'string' }
    }
  })
  const [command] = positionals
  if (command === 'keygen') {
    if (!values['key-id']) throw new Error('keygen requires --key-id')
    await generateReleaseKey(path.resolve(values.dir ?? '.release-keys'), values['key-id'])
    process.stdout.write(
      'Key generated locally. Back up the private PEM securely; commit only the reviewed public entry.\n'
    )
  } else if (command === 'sign' || command === 'verify') {
    const directory = path.resolve(values.dir ?? 'release-artifacts')
    const trust = JSON.parse(
      await fs.readFile(values.trust ?? 'resources/release-public-keys.json', 'utf8')
    )
    const version = values.version ?? JSON.parse(await fs.readFile('package.json', 'utf8')).version
    if (command === 'sign') {
      const keyId = values['key-id'] ?? trust.activeKeyId
      if (!keyId) throw new Error('sign requires --key-id or trust.activeKeyId')
      await verifyCandidate(directory, version, values.revision)
      await signCandidate(
        directory,
        keyId,
        values['private-key']
          ? await fs.readFile(values['private-key'], 'utf8')
          : process.env.PI_HARNESS_RELEASE_SIGNING_KEY,
        trust
      )
    }
    await verifyCandidate(directory, version, values.revision, { requireSignature: true, trust })
    process.stdout.write('Release signature, manifest and every local asset verified.\n')
  } else throw new Error('Expected keygen, sign or verify')
} catch (error) {
  process.stderr.write(`Release signing failed: ${error.message}\n`)
  process.exitCode = 1
}

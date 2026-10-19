import fs from 'node:fs/promises'
import path from 'node:path'
import { createPublicKey, sign } from 'node:crypto'
import { privateKeyFromSecret } from './keys.mjs'
import {
  trustedPublicKey,
  verifyManifestSignature
} from '../../../src/main/updater/security/manifest.mjs'

export async function signCandidate(directory, keyId, secret, trust) {
  const privateKey = privateKeyFromSecret(secret)
  const publicKey = trustedPublicKey(trust, keyId)
  if (!publicKey.equals(createPublicKey(privateKey)))
    throw new Error('Release signing secret does not match the embedded public key ID')
  const bytes = await fs.readFile(path.join(directory, 'checksums.json'))
  const envelope = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      algorithm: 'Ed25519',
      keyId,
      signature: sign(null, bytes, privateKey).toString('base64')
    }) + '\n'
  )
  verifyManifestSignature(bytes, envelope, trust)
  await fs.writeFile(path.join(directory, 'checksums.json.sig'), envelope, { flag: 'wx' })
}

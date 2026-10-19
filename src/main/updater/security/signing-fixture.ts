// Test-only ephemeral identity. No maintainer credentials or static private keys.
import { generateKeyPairSync, sign, createHash } from 'node:crypto'
import { assetNames, releasePlatforms, releaseVariants } from './manifest.mjs'

export function signingFixture(version = '2.0.1', revision = 'revision') {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const keyId = 'ephemeral-test-key'
  const trust = {
    schemaVersion: 1,
    keys: [
      {
        keyId,
        publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
        revoked: false
      }
    ]
  }
  const payload = Buffer.from('fixture installer')
  const sha256 = createHash('sha256').update(payload).digest('hex')
  const manifest = {
    version,
    channel: 'community',
    revision,
    artifacts: releasePlatforms.flatMap((target) =>
      releaseVariants.flatMap((variant) =>
        assetNames(version, target, variant).map((file) => ({
          file,
          platform: target.split('-')[0],
          arch: target.split('-')[1],
          variant,
          size: payload.length,
          sha256
        }))
      )
    )
  }
  const encode = () => Buffer.from(JSON.stringify(manifest, null, 2) + '\n')
  const seal = (bytes: Buffer) =>
    Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        algorithm: 'Ed25519',
        keyId,
        signature: sign(null, bytes, privateKey).toString('base64')
      }) + '\n'
    )
  const bytes = encode()
  return {
    privateKey,
    publicKey,
    keyId,
    trust,
    payload,
    manifest,
    bytes,
    signature: seal(bytes),
    encode,
    seal
  }
}

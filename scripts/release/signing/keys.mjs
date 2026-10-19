import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { keyIdentifier } from '../../../src/main/updater/security/manifest.mjs'

export function privateKeyFromSecret(secret) {
  if (!secret?.trim())
    throw new Error('PI_HARNESS_RELEASE_SIGNING_KEY is required; unsigned publication is forbidden')
  try {
    const pem = secret.trim().startsWith('-----BEGIN PRIVATE KEY-----')
      ? secret.trim()
      : Buffer.from(secret.trim(), 'base64').toString('utf8')
    if (!pem.startsWith('-----BEGIN PRIVATE KEY-----')) throw new Error()
    const key = createPrivateKey(pem)
    if (key.asymmetricKeyType !== 'ed25519') throw new Error()
    return key
  } catch {
    // Never include parser errors, environment values, or key material.
    throw new Error('Invalid release signing secret: expected Ed25519 PKCS8 PEM or Base64 PEM')
  }
}

export async function generateReleaseKey(directory, keyId) {
  if (process.env.CI || process.env.GITHUB_ACTIONS)
    throw new Error('Generate release private keys locally, never in CI')
  if (!keyIdentifier.test(keyId)) throw new Error('Invalid release key ID')
  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  // Exclusive writes prevent accidental key replacement. PEM never reaches stdout.
  await fs.writeFile(
    path.join(directory, `${keyId}.private.pem`),
    privateKey.export({ type: 'pkcs8', format: 'pem' }),
    { flag: 'wx', mode: 0o600 }
  )
  const entry = {
    keyId,
    publicKey: createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }),
    revoked: false
  }
  await fs.writeFile(
    path.join(directory, `${keyId}.public.pem`),
    publicKey.export({ type: 'spki', format: 'pem' }),
    { flag: 'wx', mode: 0o644 }
  )
  await fs.writeFile(
    path.join(directory, `${keyId}.public.json`),
    JSON.stringify(entry, null, 2) + '\n',
    { flag: 'wx', mode: 0o644 }
  )
  return entry
}

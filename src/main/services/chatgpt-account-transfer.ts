import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto'
import { promisify } from 'node:util'
import { z } from 'zod'
import { ValidationError } from './errors'

const derive = promisify(scrypt)
const kind = 'pi-harness-chatgpt-account-v1'
export const maxAccountTransferBytes = 256 * 1024
const envelope = z.strictObject({
  kind: z.literal(kind),
  salt: z.string().regex(/^[0-9a-f]{32}$/),
  iv: z.string().regex(/^[0-9a-f]{24}$/),
  tag: z.string().regex(/^[0-9a-f]{32}$/),
  data: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/)
})
const credentialSchema = z
  .object({
    type: z.literal('oauth'),
    access: z.string().min(1).max(32768),
    refresh: z.string().min(1).max(32768),
    clientId: z.string().regex(/^oaiapp_[A-Za-z0-9_-]{1,255}$/),
    expires: z.number().int().positive()
  })
  .passthrough()
const profile = z.strictObject({
  label: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[^\p{Cc}\p{Cf}]+$/u),
  credential: credentialSchema
})
type Profile = z.infer<typeof profile>

export async function encryptAccountTransfer(input: Profile, password: string): Promise<string> {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = (await derive(password, salt, 32)) as Buffer
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    cipher.setAAD(Buffer.from(kind))
    const data = Buffer.concat([
      cipher.update(JSON.stringify(profile.parse(input)), 'utf8'),
      cipher.final()
    ])
    const result = JSON.stringify({
      kind,
      salt: salt.toString('hex'),
      iv: iv.toString('hex'),
      tag: cipher.getAuthTag().toString('hex'),
      data: data.toString('base64')
    })
    if (Buffer.byteLength(result) > maxAccountTransferBytes)
      throw new ValidationError('ChatGPT account backup is too large')
    return result
  } finally {
    key.fill(0)
  }
}

export async function decryptAccountTransfer(text: string, password: string): Promise<Profile> {
  let key: Buffer | undefined
  try {
    const input = envelope.parse(JSON.parse(text))
    key = (await derive(password, Buffer.from(input.salt, 'hex'), 32)) as Buffer
    const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(input.iv, 'hex'))
    cipher.setAAD(Buffer.from(kind))
    cipher.setAuthTag(Buffer.from(input.tag, 'hex'))
    const bytes = Buffer.concat([cipher.update(Buffer.from(input.data, 'base64')), cipher.final()])
    return profile.parse(JSON.parse(bytes.toString('utf8')))
  } catch {
    throw new ValidationError('Incorrect password or invalid ChatGPT account backup')
  } finally {
    key?.fill(0)
  }
}

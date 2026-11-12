/**
 * SecretStore — OS-backed secret storage for API keys.
 *
 * Two strategies, chosen by platform:
 *
 *   macOS  — store the secret in the system Keychain via the `security` CLI
 *            (execFile, args array — never a shell string). The value written
 *            to Pi's models.json is a `!command` that retrieves it at request
 *            time, mirroring the pattern Pi itself documents:
 *              "!security find-generic-password -a \"$USER\" -s \"pi-harness-<id>\" -w"
 *            This keeps the plaintext key out of config files entirely.
 *
 *   other  — encrypt the secret with Electron `safeStorage` (DPAPI on Windows,
 *            Secret Service/libsecret on Linux) and hold the ciphertext in a
 *            vault file under userData. The desktop Pi runtime resolves
 *            the provider's stored reference and passes the key in memory.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import { safeStorage } from 'electron'
import path from 'node:path'
import { log } from '../services/logger'
import { appSecretVaultPath } from '../services/app-paths'
import { atomicWriteText } from '../services/storage'
import { SecurityError } from '../services/errors'

const execFileP = promisify(execFile)

const isMac = process.platform === 'darwin'
const SERVICE = 'pi-harness'

/** Stable keychain service name for a stored secret. */
function keyService(id: string): string {
  return `${SERVICE}-${id}`
}

/** The Pi models.json `!command` that retrieves a macOS keychain secret. */
export function macKeychainCommand(id: string): string {
  return `!security find-generic-password -a "$USER" -s "${keyService(id)}" -w`
}

const managedProviderReference = /^prov-[A-Za-z0-9][A-Za-z0-9._+-]{0,127}-[0-9a-f]{8}$/
const vaultPrefix = '$PI_HARNESS_VAULT_'
const providerPayloadPrefix = 'pi-harness-provider-v1:'

export function managedProviderApiKey(id: string): string {
  if (!managedProviderReference.test(id)) throw new SecurityError('Invalid provider key reference')
  return vaultPrefix + Buffer.from(id).toString('hex')
}

export function managedProviderSecretId(value: string | undefined): string | null {
  if (!value?.startsWith(vaultPrefix)) return null
  const encoded = value.slice(vaultPrefix.length)
  if (!/^(?:[0-9a-f]{2}){14,142}$/.test(encoded)) return null
  const id = Buffer.from(encoded, 'hex').toString()
  return managedProviderReference.test(id) ? id : null
}

/** A masked display string safe to show in the UI. */
export function maskKey(key: string | null | undefined): string {
  if (!key) return ''
  if (key.length <= 8) return '••••••••'
  const head = key.slice(0, 4)
  const tail = key.slice(-4)
  return `${head}••••••••${tail}`
}

interface Vault {
  /** id -> base64(safeStorage-encrypt(plaintext)) */
  entries: Record<string, string>
}

class SecretStore {
  private vaultCache: Vault | null = null
  private vaultLoading: Promise<Vault> | null = null
  private vaultWrites: Promise<unknown> = Promise.resolve()

  private async vaultPath(): Promise<string> {
    return appSecretVaultPath()
  }

  private async loadVault(): Promise<Vault> {
    if (this.vaultCache) return this.vaultCache
    if (this.vaultLoading) return this.vaultLoading
    this.vaultLoading = this.readVault()
    try {
      return await this.vaultLoading
    } finally {
      this.vaultLoading = null
    }
  }

  private async readVault(): Promise<Vault> {
    const p = await this.vaultPath()
    try {
      const raw = await fs.readFile(p, 'utf8')
      this.vaultCache = JSON.parse(raw) as Vault
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') log.security.warn('vault read failed:', err)
      this.vaultCache = { entries: {} }
    }
    return this.vaultCache
  }

  private async saveVault(vault: Vault): Promise<void> {
    const p = await this.vaultPath()
    await fs.mkdir(path.dirname(p), { recursive: true })
    const text = JSON.stringify(vault, null, 2)
    await atomicWriteText(p, text)
    await fs.chmod(p, 0o600).catch(() => {})
  }

  private updateVault(change: (entries: Vault['entries']) => boolean): Promise<void> {
    const pending = this.vaultWrites
      .catch(() => {})
      .then(async () => {
        const current = await this.loadVault()
        const next = { ...current, entries: { ...current.entries } }
        if (!change(next.entries)) return
        await this.saveVault(next)
        this.vaultCache = next
      })
    this.vaultWrites = pending
    return pending
  }

  /** Whether OS-backed encryption is available (safeStorage.isEncryptionAvailable). */
  isAvailable(): boolean {
    try {
      return typeof safeStorage !== 'undefined' && safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  /** Store a plaintext secret. Returns the secret id used for retrieval. */
  async setSecret(id: string, plaintext: string, options?: { strict?: boolean }): Promise<void> {
    if (isMac) {
      // Use the macOS keychain via the `security` CLI. Args array — no shell.
      try {
        // -U updates if exists; delete first to avoid duplicate-password prompts.
        if (!options?.strict)
          await execFileP(
            'security',
            ['delete-generic-password', '-a', process.env.USER ?? '', '-s', keyService(id)],
            {
              timeout: 5000
            }
          ).catch(() => {
            /* ignore not-found */
          })
        await execFileP(
          'security',
          [
            'add-generic-password',
            ...(options?.strict ? ['-U'] : []),
            '-a',
            process.env.USER ?? '',
            '-s',
            keyService(id),
            '-w',
            plaintext
          ],
          { timeout: 5000 }
        )
        return
      } catch (err) {
        if (options?.strict) throw new SecurityError('Secure credential storage failed')
        log.security.warn(`keychain write failed for ${id}, falling back to vault:`, err)
        // fall through to vault
      }
    }
    if (!this.isAvailable()) {
      throw new SecurityError('Encrypted storage unavailable on this system')
    }
    if (
      options?.strict &&
      process.platform === 'linux' &&
      safeStorage.getSelectedStorageBackend() === 'basic_text'
    )
      throw new SecurityError('Secure credential storage unavailable')
    const buf = safeStorage.encryptString(plaintext)
    await this.updateVault((entries) => {
      entries[id] = buf.toString('base64')
      return true
    })
  }

  /** Retrieve a plaintext secret (macOS: from keychain; otherwise: decrypt vault). */
  async getSecret(id: string, options?: { strict?: boolean }): Promise<string | null> {
    if (isMac) {
      try {
        const { stdout } = await execFileP(
          'security',
          ['find-generic-password', '-a', process.env.USER ?? '', '-s', keyService(id), '-w'],
          { timeout: 5000 }
        )
        const v = stdout.trim()
        return v || null
      } catch (err) {
        if (options?.strict && (err as { code?: number }).code !== 44)
          throw new SecurityError('Secure credential storage unavailable')
        log.security.debug(`keychain read miss for ${id}:`, err)
        // fall through to vault (may have been written before a keychain failure)
      }
    }
    const vault = await this.loadVault()
    const b64 = vault.entries[id]
    if (!b64) return null
    if (
      !this.isAvailable() ||
      (options?.strict &&
        process.platform === 'linux' &&
        safeStorage.getSelectedStorageBackend() === 'basic_text')
    )
      throw new SecurityError('Encrypted storage unavailable')
    try {
      return safeStorage.decryptString(Buffer.from(b64, 'base64'))
    } catch (err) {
      log.security.error('vault decrypt failed:', err)
      throw new SecurityError('Failed to decrypt stored secret')
    }
  }

  async removeSecret(id: string, options?: { strict?: boolean }): Promise<void> {
    if (isMac) {
      await execFileP(
        'security',
        ['delete-generic-password', '-a', process.env.USER ?? '', '-s', keyService(id)],
        {
          timeout: 5000
        }
      ).catch((error) => {
        if (options?.strict && error?.code !== 44)
          throw new SecurityError('Secure credential removal failed')
      })
    }
    await this.updateVault((entries) => {
      if (!(id in entries)) return false
      delete entries[id]
      return true
    })
  }

  async setProviderSecret(id: string, apiKey: string, baseUrl: string): Promise<void> {
    const origin = URL.parse(baseUrl)?.origin
    if (!origin || origin === 'null') throw new SecurityError('Invalid provider endpoint')
    const value = isMac ? apiKey : providerPayloadPrefix + JSON.stringify({ origin, apiKey })
    await this.setSecret(id, value, { strict: true })
  }

  async getProviderSecret(
    id: string,
    baseUrl: string,
    requireBinding = false
  ): Promise<string | null> {
    const value = await this.getSecret(id, { strict: true })
    if (!value?.startsWith(providerPayloadPrefix)) return requireBinding ? null : value
    const bound = JSON.parse(value.slice(providerPayloadPrefix.length)) as {
      origin?: unknown
      apiKey?: unknown
    }
    const origin = URL.parse(baseUrl)?.origin
    return origin &&
      origin !== 'null' &&
      bound.origin === origin &&
      typeof bound.apiKey === 'string'
      ? bound.apiKey
      : null
  }
}

export const secretStore = new SecretStore()

// Touch crypto to avoid tree-shake surprises on the vault nonce path.
void randomBytes

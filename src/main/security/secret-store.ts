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
 *            vault file under userData. The value written to Pi's models.json
 *            is the resolved literal (Pi's native field).
 *
 * Pi-Harness never persists its own secrets as plaintext JSON, and the
 * renderer never holds plaintext keys — it only sees a masked display string.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import { app, safeStorage } from 'electron'
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

  private async vaultPath(): Promise<string> {
    return appSecretVaultPath()
  }

  private async loadVault(): Promise<Vault> {
    if (this.vaultCache) return this.vaultCache
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

  /** Whether OS-backed encryption is available (safeStorage.isEncryptionAvailable). */
  isAvailable(): boolean {
    try {
      return typeof safeStorage !== 'undefined' && safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  /** Store a plaintext secret. Returns the secret id used for retrieval. */
  async setSecret(id: string, plaintext: string): Promise<void> {
    if (isMac) {
      // Use the macOS keychain via the `security` CLI. Args array — no shell.
      try {
        // -U updates if exists; delete first to avoid duplicate-password prompts.
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
        log.security.warn(`keychain write failed for ${id}, falling back to vault:`, err)
        // fall through to vault
      }
    }
    if (!this.isAvailable()) {
      throw new SecurityError('Encrypted storage unavailable on this system')
    }
    const vault = await this.loadVault()
    const buf = safeStorage.encryptString(plaintext)
    vault.entries[id] = buf.toString('base64')
    await this.saveVault(vault)
  }

  /** Retrieve a plaintext secret (macOS: from keychain; otherwise: decrypt vault). */
  async getSecret(id: string): Promise<string | null> {
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
        log.security.debug(`keychain read miss for ${id}:`, err)
        // fall through to vault (may have been written before a keychain failure)
      }
    }
    const vault = await this.loadVault()
    const b64 = vault.entries[id]
    if (!b64) return null
    if (!this.isAvailable()) throw new SecurityError('Encrypted storage unavailable')
    try {
      return safeStorage.decryptString(Buffer.from(b64, 'base64'))
    } catch (err) {
      log.security.error('vault decrypt failed:', err)
      throw new SecurityError('Failed to decrypt stored secret')
    }
  }

  async removeSecret(id: string): Promise<void> {
    if (isMac) {
      await execFileP(
        'security',
        ['delete-generic-password', '-a', process.env.USER ?? '', '-s', keyService(id)],
        {
          timeout: 5000
        }
      ).catch(() => {})
    }
    const vault = await this.loadVault()
    if (id in vault.entries) {
      delete vault.entries[id]
      await this.saveVault(vault)
    }
  }

  /**
   * The value to write into Pi's models.json `apiKey` for a secret identified
   * by `id`. macOS: a `!command`. Other platforms: the resolved literal.
   */
  async serialisedApiKeyValue(id: string): Promise<string> {
    if (isMac) return macKeychainCommand(id)
    const secret = await this.getSecret(id)
    if (secret === null) throw new SecurityError(`Secret not found: ${id}`)
    return secret
  }
}

export const secretStore = new SecretStore()

// Touch app import so electron types are surfaced without an unused warning.
void app

// Touch crypto to avoid tree-shake surprises on the vault nonce path.
void randomBytes

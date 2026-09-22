/**
 * Electron API stubs used by the ported desktop services.
 *
 * The sidecar never talks to Chromium. Host-owned actions (open URL,
 * clipboard, native dialogs) throw a typed marker so domain handlers can
 * forward them to Rust.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { homedir, tmpdir } from 'node:os'
import fs from 'node:fs/promises'
import path from 'node:path'
import { runtimeUserDataDir } from '../harness-control/paths.js'

export class HostActionError extends Error {
  readonly action: string
  readonly payload: Record<string, unknown>

  constructor(action: string, payload: Record<string, unknown> = {}) {
    super(`Host action required: ${action}`)
    this.name = 'HostActionError'
    this.action = action
    this.payload = payload
  }
}

export const app = {
  isPackaged: process.env.PI_HARNESS_PACKAGED === '1',
  getPath(name: string): string {
    if (name === 'userData') return runtimeUserDataDir()
    if (name === 'home') return homedir()
    if (name === 'temp' || name === 'tmpdir') return tmpdir()
    if (name === 'appData') return path.dirname(runtimeUserDataDir())
    return runtimeUserDataDir()
  },
  getAppPath(): string {
    return process.env.PI_HARNESS_APP_PATH?.trim() || process.cwd()
  },
  getVersion(): string {
    return process.env.PI_HARNESS_APP_VERSION?.trim() || '0.0.0'
  }
}

export const shell = {
  async openExternal(url: string): Promise<void> {
    throw new HostActionError('openExternal', { url })
  },
  async openPath(target: string): Promise<string> {
    throw new HostActionError('openPath', { path: target })
  },
  showItemInFolder(target: string): void {
    throw new HostActionError('showItem', { path: target })
  }
}

export const clipboard = {
  writeText(text: string): void {
    throw new HostActionError('clipboardWrite', { text })
  }
}

const VAULT_ALGO = 'aes-256-gcm'

function vaultKey(): Buffer {
  const secret = process.env.PI_HARNESS_VAULT_KEY?.trim() || `pi-harness:${homedir()}:${process.platform}`
  return scryptSync(secret, 'pi-harness-vault', 32)
}

export const safeStorage = {
  isEncryptionAvailable(): boolean {
    return true
  },
  encryptString(plaintext: string): Buffer {
    const iv = randomBytes(12)
    const cipher = createCipheriv(VAULT_ALGO, vaultKey(), iv)
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return Buffer.concat([iv, tag, encrypted])
  },
  decryptString(payload: Buffer): string {
    const iv = payload.subarray(0, 12)
    const tag = payload.subarray(12, 28)
    const encrypted = payload.subarray(28)
    const decipher = createDecipheriv(VAULT_ALGO, vaultKey(), iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
  }
}

void fs

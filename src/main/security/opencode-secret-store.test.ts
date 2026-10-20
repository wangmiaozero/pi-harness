// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({
  exec: vi.fn(),
  encrypt: vi.fn(() => Buffer.from('encrypted-value')),
  decrypt: vi.fn(() => 'test-only-key'),
  available: vi.fn(() => true),
  backend: vi.fn(() => 'gnome_libsecret'),
  write: vi.fn(),
  log: { warn: vi.fn(), debug: vi.fn(), error: vi.fn() }
}))
vi.mock('node:child_process', () => ({
  execFile: Object.assign(vi.fn(), { [Symbol.for('nodejs.util.promisify.custom')]: h.exec })
}))
vi.mock('electron', () => ({
  app: {},
  safeStorage: {
    isEncryptionAvailable: h.available,
    getSelectedStorageBackend: h.backend,
    encryptString: h.encrypt,
    decryptString: h.decrypt
  }
}))
vi.mock('node:fs/promises', () => ({
  default: {
    readFile: vi.fn(async () =>
      JSON.stringify({ entries: { 'opencode-free-official': 'encrypted' } })
    ),
    mkdir: vi.fn(),
    chmod: vi.fn(async () => undefined)
  }
}))
vi.mock('../services/app-paths', () => ({ appSecretVaultPath: () => '/test-only/vault.json' }))
vi.mock('../services/storage', () => ({ atomicWriteText: h.write }))
vi.mock('../services/logger', () => ({ log: { security: h.log } }))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetAllMocks()
  vi.resetModules()
})
async function store(platform: string) {
  vi.stubGlobal('process', { ...process, platform })
  return (await import('./secret-store')).secretStore
}
describe('OpenCode strict credential storage (mock OS only)', () => {
  it('updates macOS Keychain without deleting the previous value first', async () => {
    h.exec.mockResolvedValue({ stdout: '' })
    const secrets = await store('darwin')
    await secrets.setSecret('opencode-free-official', 'test-only-key', { strict: true })
    expect(h.exec).toHaveBeenCalledTimes(1)
    expect(h.exec.mock.calls[0][1]).toContain('-U')
    expect(h.exec.mock.calls[0][1][0]).toBe('add-generic-password')
    expect(h.write).not.toHaveBeenCalled()
  })
  it('redacts a failed keychain command and refuses fallback storage', async () => {
    h.exec.mockRejectedValue(new Error('command with test-only-key'))
    const secrets = await store('darwin')
    await expect(
      secrets.setSecret('opencode-free-official', 'test-only-key', { strict: true })
    ).rejects.toThrow('Secure credential storage failed')
    expect(h.log.warn).not.toHaveBeenCalled()
    expect(h.encrypt).not.toHaveBeenCalled()
    expect(h.write).not.toHaveBeenCalled()
  })
  it('reports a failed macOS credential deletion instead of claiming it was removed', async () => {
    h.exec.mockRejectedValue(Object.assign(new Error('locked'), { code: 36 }))
    const secrets = await store('darwin')
    await expect(secrets.removeSecret('opencode-free-official', { strict: true })).rejects.toThrow(
      'Secure credential removal failed'
    )
  })
  it('refuses unavailable encryption on Windows', async () => {
    h.available.mockReturnValue(false)
    const secrets = await store('win32')
    await expect(
      secrets.setSecret('opencode-free-official', 'test-only-key', { strict: true })
    ).rejects.toThrow('Encrypted storage unavailable')
    expect(h.encrypt).not.toHaveBeenCalled()
  })
  it('refuses the Linux basic_text backend for writes and reads', async () => {
    h.available.mockReturnValue(true)
    h.backend.mockReturnValue('basic_text')
    const secrets = await store('linux')
    await expect(
      secrets.setSecret('opencode-free-official', 'test-only-key', { strict: true })
    ).rejects.toThrow('Secure credential storage unavailable')
    await expect(secrets.getSecret('opencode-free-official', { strict: true })).rejects.toThrow(
      'Encrypted storage unavailable'
    )
    expect(h.encrypt).not.toHaveBeenCalled()
    expect(h.decrypt).not.toHaveBeenCalled()
  })
  it('persists only encrypted bytes using Windows secure storage', async () => {
    h.available.mockReturnValue(true)
    h.encrypt.mockReturnValue(Buffer.from('encrypted-value'))
    const secrets = await store('win32')
    await secrets.setSecret('opencode-free-official', 'test-only-key', { strict: true })
    expect(h.write).toHaveBeenCalledTimes(1)
    expect(h.write.mock.calls[0][1]).not.toContain('test-only-key')
    expect(h.write.mock.calls[0][1]).toContain(Buffer.from('encrypted-value').toString('base64'))
  })
})

import fs from 'node:fs/promises'
import type { NsisUpdater } from 'electron-updater'
import type { TrustedCandidate } from './update-provider'
import { verifyInstaller } from './security/manifest.mjs'
import { installCapability } from './update-capabilities'
import { UpdateError } from './update-error'
import { atomicWriteJson } from '../services/storage'

export interface PendingUpgrade {
  schemaVersion: 1
  fromVersion: string
  toVersion: string
  variant: string
  installer: string
  backup: string | null
  target: string | null
  status: 'prepared' | 'launched' | 'completed' | 'failed'
}

export { stageAppImage } from './appimage-transaction.mjs'
import { stageAppImage } from './appimage-transaction.mjs'

/** The pinned NSIS implementation is reused only after our own signature/hash gate. */
export function createVerifiedNsisClass(Base: typeof NsisUpdater): new () => {
  start(file: string): Promise<void>
  on(event: 'error', listener: () => void): unknown
} {
  return class VerifiedNsis extends Base {
    private verifiedFile: string | null = null
    private launch: Promise<boolean> | null = null
    protected get installerPath() {
      return this.verifiedFile
    }
    protected spawnLog(command: string, args: string[] = []): Promise<boolean> {
      // No elevation fallback, shell, arbitrary executable or renderer path.
      if (command !== this.verifiedFile || args.join('\0') !== '--updated\0--force-run')
        return Promise.reject(
          new UpdateError('INSTALL_LAUNCH_FAILED', 'The installer requires a manual installation.')
        )
      this.launch = super.spawnLog(command, args)
      return this.launch
    }
    async start(file: string): Promise<void> {
      this.verifiedFile = file
      this.autoDownload = false
      this.autoInstallOnAppQuit = false
      this.autoRunAppAfterInstall = true
      // Preserve the pinned 6.8.10 publisher verification, including unsigned
      // Community behavior. Fail closed if a future library removes this hook.
      const verifier = Reflect.get(this, 'verifySignature') as
        ((file: string) => Promise<unknown>) | undefined
      if (typeof verifier !== 'function' || (await verifier.call(this, file)) !== null)
        throw new UpdateError(
          'INSTALL_SIGNATURE_FAILED',
          'The Windows publisher signature could not be verified.'
        )
      if (
        !this.doInstall({ isSilent: false, isForceRunAfter: true, isAdminRightsRequired: false }) ||
        !this.launch
      )
        throw new UpdateError('INSTALL_LAUNCH_FAILED', 'The installer could not be started.', true)
      await this.launch
    }
  }
}

export async function installVerifiedUpdate(options: {
  platform: string
  arch: string
  variant: string
  currentVersion: string
  candidate: TrustedCandidate
  file: string
  journal: string
  appImage?: string
  relaunch: (executable?: string) => void
  quit: () => void
}) {
  const { candidate, platform, arch, variant, currentVersion, file } = options
  if (!installCapability(platform, arch, variant, currentVersion, candidate.version).canInstall)
    throw new UpdateError(
      'INSTALL_UNVERIFIED',
      'Automatic installation has not passed native upgrade verification for this platform. Use the verified manual installer.'
    )
  await verifyInstaller(file, candidate.installer)
  const pending: PendingUpgrade = {
    schemaVersion: 1,
    fromVersion: currentVersion,
    toVersion: candidate.version,
    variant,
    installer: file,
    backup: null,
    target: null,
    status: 'prepared'
  }
  await atomicWriteJson(options.journal, pending)
  try {
    if (platform === 'win32') {
      const { default: updater } = await import('electron-updater')
      const VerifiedNsis = createVerifiedNsisClass(updater.NsisUpdater)
      const instance = new VerifiedNsis()
      instance.on('error', () => {}) // Start() awaits the actual spawn failure.
      await instance.start(file)
    } else if (
      platform === 'linux' &&
      options.appImage &&
      !process.env.SNAP &&
      !process.env.FLATPAK_ID
    ) {
      const result = await stageAppImage(await fs.realpath(options.appImage), file, candidate)
      Object.assign(pending, result)
      await atomicWriteJson(options.journal, pending)
      options.relaunch(result.target)
    } else
      throw new UpdateError(
        'INSTALL_UNSUPPORTED',
        'Use the verified installer to update this application manually.'
      )
    pending.status = 'launched'
    await atomicWriteJson(options.journal, pending)
    options.quit()
  } catch (error) {
    if (pending.backup && pending.target) await fs.rename(pending.backup, pending.target)
    pending.status = 'failed'
    await atomicWriteJson(options.journal, pending)
    throw error
  }
}

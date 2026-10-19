import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { AppUpdateState, UpdatePreferences } from '@shared/update'
import { updatePreferencesSchema } from '@shared/schemas/update'
import { ReleaseProvider } from './update-provider'
import type { TrustedCandidate } from './update-provider'
import { UpdateDownload } from './update-download'
import { installCapability } from './update-capabilities'
import { UpdateError, updateFailure } from './update-error'
import { atomicWriteJson } from '../services/storage'
import { log } from '../services/logger'

export interface UpdateManagerOptions {
  currentVersion: string
  platform: string
  arch: string
  variant: string
  packaged: boolean
  mode: 'manual' | 'download' | 'automatic'
  directory: string
  provider: ReleaseProvider
  downloader: UpdateDownload
  reveal: (file: string) => void
  install: (candidate: TrustedCandidate, file: string) => Promise<void>
  healthCheck: () => Promise<void>
}
export class UpdateManager {
  private state: AppUpdateState
  private candidate: TrustedCandidate | null = null
  private file: string | null = null
  private task: Promise<AppUpdateState> | null = null
  private controller: AbortController | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private listeners = new Set<(state: AppUpdateState) => void>()
  private loading: Promise<void> | null = null
  private stopped = true
  private lastAction: 'check' | 'download' = 'check'
  constructor(private readonly options: UpdateManagerOptions) {
    this.state = {
      supported: true,
      available: false,
      currentVersion: options.currentVersion,
      latestVersion: null,
      status: 'idle',
      downloaded: false,
      downloadProgress: null,
      bytesReceived: 0,
      totalBytes: null,
      bytesPerSecond: 0,
      fileName: null,
      releaseNotes: '',
      signature: 'unchecked',
      integrity: 'unchecked',
      readiness: 'MANUAL_ONLY',
      canInstall: false,
      canResume: false,
      autoDownloadAllowed: options.mode !== 'manual',
      preferences: { autoCheck: true, autoDownload: false },
      error: null
    }
  }
  snapshot(): AppUpdateState {
    return structuredClone(this.state)
  }
  onState(listener: (state: AppUpdateState) => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private set(patch: Partial<AppUpdateState>) {
    Object.assign(this.state, patch)
    const state = this.snapshot()
    for (const listener of this.listeners) {
      try {
        listener(state)
      } catch {
        log.updater.warn('Update listener failed')
      }
    }
    return state
  }
  private initialize() {
    return (this.loading ??= (async () => {
      try {
        const preferences = updatePreferencesSchema.parse(
          JSON.parse(
            await fs.readFile(path.join(this.options.directory, 'preferences.json'), 'utf8')
          )
        )
        this.set({ preferences })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          this.set({ preferences: { autoCheck: false, autoDownload: false } })
      }
      try {
        const journal = z
          .object({
            schemaVersion: z.literal(1),
            fromVersion: z.string(),
            toVersion: z.string(),
            variant: z.string(),
            status: z.enum(['prepared', 'launched', 'completed', 'failed'])
          })
          .passthrough()
          .parse(
            JSON.parse(await fs.readFile(path.join(this.options.directory, 'upgrade.json'), 'utf8'))
          )
        if (journal.status === 'completed') return
        if (
          (journal.status === 'launched' ||
            (journal.status === 'prepared' && journal.mode === 'manual')) &&
          journal.toVersion === this.options.currentVersion &&
          journal.variant === this.options.variant
        ) {
          await this.options.healthCheck()
          await atomicWriteJson(path.join(this.options.directory, 'upgrade.json'), {
            ...journal,
            status: 'completed'
          })
          this.set({ status: 'completed', latestVersion: journal.toVersion })
        } else if (!(journal.status === 'prepared' && journal.mode === 'manual'))
          this.set({
            status: 'manual_fallback',
            error: {
              code: 'RESTART_NOT_CONFIRMED',
              message:
                'The update restart was not confirmed. Use the official installer to recover this installation.',
              retryable: true
            }
          })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          this.set({
            status: 'manual_fallback',
            error: {
              code: 'HEALTH_CHECK_FAILED',
              message:
                'The updated app could not confirm its startup health. Use the official manual installer.',
              retryable: false
            }
          })
      }
    })())
  }
  async preferences(next: UpdatePreferences) {
    await this.initialize()
    const preferences = updatePreferencesSchema.parse(next)
    await atomicWriteJson(path.join(this.options.directory, 'preferences.json'), preferences)
    this.set({ preferences })
    this.schedule()
    return this.snapshot()
  }
  check(): Promise<AppUpdateState> {
    if (this.task) return this.task
    if (this.state.downloaded) return Promise.resolve(this.snapshot())
    this.lastAction = 'check'
    this.task = this.performCheck().finally(() => {
      this.task = null
      this.controller = null
      this.schedule()
    })
    return this.task
  }
  private async performCheck() {
    await this.initialize()
    this.controller = new AbortController()
    this.set({
      status: 'checking',
      error: null,
      signature: 'unchecked',
      integrity: 'unchecked',
      canInstall: false
    })
    this.candidate = null
    try {
      const version = await this.options.provider.latest(this.controller.signal)
      this.set({ latestVersion: version })
      const { gt } = await import('semver')
      if (!gt(version, this.options.currentVersion))
        return this.set({
          status: 'idle',
          available: false,
          downloaded: false,
          totalBytes: null,
          fileName: null,
          releaseNotes: ''
        })
      this.set({ available: true })
      this.candidate = await this.options.provider.authenticate(
        version,
        this.options.currentVersion,
        this.controller.signal
      )
      const capability = installCapability(
        this.options.platform,
        this.options.arch,
        this.options.variant,
        this.options.currentVersion,
        version
      )
      this.set({
        status: 'available',
        signature: 'verified',
        fileName: this.candidate.installer.file,
        totalBytes: this.candidate.installer.size,
        releaseNotes: this.candidate.manifest.releaseNotes ?? '',
        readiness: capability.readiness
      })
      if (this.state.preferences.autoDownload && this.state.autoDownloadAllowed)
        return this.performDownload()
      return this.snapshot()
    } catch (error) {
      const failure = updateFailure(error)
      return this.set({
        status: this.state.available ? 'manual_fallback' : 'failed',
        error: failure,
        signature:
          failure.code === 'SIGNATURE_MISSING'
            ? 'missing'
            : failure.code === 'SIGNATURE_INVALID'
              ? 'invalid'
              : 'unchecked',
        canInstall: false
      })
    }
  }
  download(): Promise<AppUpdateState> {
    if (this.task) return this.task
    if (!this.candidate)
      return Promise.resolve(
        this.set({
          status: 'manual_fallback',
          error: {
            code: 'SIGNATURE_REQUIRED',
            message: 'Check and authenticate the release before downloading it.',
            retryable: true
          }
        })
      )
    this.lastAction = 'download'
    this.task = this.performDownload().finally(() => {
      this.task = null
      this.controller = null
      this.schedule()
    })
    return this.task
  }
  private async performDownload() {
    this.lastAction = 'download'
    await this.initialize()
    const selected = this.candidate!
    this.controller = new AbortController()
    this.set({
      status: 'downloading',
      error: null,
      downloaded: false,
      integrity: 'unchecked',
      canInstall: false,
      bytesPerSecond: 0
    })
    try {
      // Re-authenticate every retry/restart; a cache never establishes trust.
      const fresh = await this.options.provider.authenticate(
        selected.version,
        this.options.currentVersion,
        this.controller.signal
      )
      if (!fresh.bytes.equals(selected.bytes))
        throw new UpdateError(
          'MANIFEST_CHANGED',
          'The immutable release manifest changed. Check the release again.'
        )
      this.file = await this.options.downloader.run(
        selected,
        this.controller.signal,
        ({ received, total, speed }) =>
          this.set({
            bytesReceived: received,
            totalBytes: total,
            bytesPerSecond: speed,
            downloadProgress: (received / total) * 100
          }),
        () => this.set({ status: 'verifying', integrity: 'verifying', bytesPerSecond: 0 })
      )
      const capability = installCapability(
        this.options.platform,
        this.options.arch,
        this.options.variant,
        this.options.currentVersion,
        selected.version
      )
      return this.set({
        status:
          capability.canInstall && this.options.mode === 'automatic'
            ? 'ready_to_install'
            : 'manual_fallback',
        downloaded: true,
        signature: 'verified',
        integrity: 'verified',
        bytesReceived: selected.installer.size,
        downloadProgress: 100,
        canResume: false,
        canInstall:
          this.options.packaged && this.options.mode === 'automatic' && capability.canInstall,
        readiness: capability.canInstall ? 'AUTO_INSTALL_VERIFIED' : 'DOWNLOAD_VERIFIED'
      })
    } catch (error) {
      const failure = updateFailure(
        this.controller.signal.aborted
          ? new UpdateError(
              'DOWNLOAD_CANCELLED',
              'The download was cancelled. You can resume it later.',
              true
            )
          : error
      )
      return this.set({
        status: failure.code === 'DOWNLOAD_CANCELLED' ? 'available' : 'failed',
        error: failure,
        signature:
          failure.code === 'SIGNATURE_INVALID'
            ? 'invalid'
            : failure.code === 'SIGNATURE_MISSING'
              ? 'missing'
              : this.state.signature,
        integrity: failure.code === 'INTEGRITY_FAILED' ? 'invalid' : 'unchecked',
        downloaded: false,
        canInstall: false,
        canResume: failure.retryable,
        bytesPerSecond: 0,
        downloadProgress: null
      })
    }
  }
  async cancel() {
    this.controller?.abort()
    if (this.task) await this.task
    return this.snapshot()
  }
  retry() {
    return this.lastAction === 'download' && this.candidate ? this.download() : this.check()
  }
  async reveal() {
    if (!this.candidate || !this.file || !this.state.downloaded)
      throw new UpdateError('DOWNLOAD_REQUIRED', 'Download and verify the installer first.')
    try {
      await this.options.downloader.revalidate(this.candidate, this.file)
      await atomicWriteJson(path.join(this.options.directory, 'upgrade.json'), {
        schemaVersion: 1,
        fromVersion: this.options.currentVersion,
        toVersion: this.candidate.version,
        variant: this.options.variant,
        status: 'prepared',
        mode: 'manual'
      })
      this.options.reveal(this.file)
    } catch (error) {
      this.set({
        status: 'failed',
        downloaded: false,
        integrity: 'invalid',
        canInstall: false,
        error: updateFailure(error)
      })
      throw error
    }
  }
  async install() {
    if (
      this.task ||
      !this.candidate ||
      !this.file ||
      this.state.status !== 'ready_to_install' ||
      !this.state.canInstall
    )
      throw new UpdateError(
        'INSTALL_UNVERIFIED',
        'Automatic installation is unavailable. Use the verified manual installer.'
      )
    const candidate = this.candidate,
      file = this.file
    this.task = (async () => {
      try {
        this.set({ status: 'verifying', integrity: 'verifying', canInstall: false })
        await this.options.downloader.revalidate(candidate, file)
        this.set({ status: 'installing', integrity: 'verified' })
        await this.options.install(candidate, file)
        return this.set({ status: 'restarting' })
      } catch (error) {
        return this.set({
          status: 'manual_fallback',
          error: updateFailure(error),
          canInstall: false
        })
      }
    })().finally(() => {
      this.task = null
    })
    await this.task
  }
  defer() {
    return this.snapshot()
  } // Explicitly never register install-on-quit.
  start(delay = 10_000) {
    this.stopped = false
    void this.initialize().then(() => this.schedule(delay))
  }
  stop() {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.controller?.abort()
  }
  private schedule(delay = 6 * 60 * 60_000) {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.stopped || !this.options.packaged || !this.state.preferences.autoCheck) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.check()
    }, delay)
    this.timer.unref()
  }
}

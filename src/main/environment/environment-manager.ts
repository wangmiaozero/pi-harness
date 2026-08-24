import { randomUUID } from 'node:crypto'
import type {
  AppSettings,
  EnvironmentInstallLog,
  EnvironmentInstallTask,
  EnvironmentInstallTaskType,
  PiEnvironment,
  PiInstallResult
} from '@shared/ipc/api-types'
import type { JsonStore } from '../services/storage'
import { piEnvironment } from '../pi/environment'
import { detectNodeRuntime, MINIMUM_NODE_VERSION } from '../pi/node-environment'
import { piProcess } from '../process/pi-process'
import { PiInstallService, type PiInstallProgress } from '../pi/install-service'
import { NodeInstaller, type NodeInstallProgress } from './node-installer'
import { refreshRuntimePath } from './path-manager'
import { AppError, EnvironmentError, toErrorPayload, ValidationError } from '../services/errors'

interface EnvironmentManagerDependencies {
  nodeInstaller: NodeInstaller
  piInstaller: PiInstallService
  detectRuntime: typeof detectNodeRuntime
  detectEnvironment: (settings: AppSettings) => Promise<PiEnvironment>
  refreshPath: typeof refreshRuntimePath
  uuid: () => string
  now: () => number
  onTask: (task: EnvironmentInstallTask) => void
  onEnvironmentChanged: (environment: PiEnvironment) => void
}

export class EnvironmentManager {
  private readonly dependencies: EnvironmentManagerDependencies
  private task: EnvironmentInstallTask | null = null
  private active: Promise<EnvironmentInstallTask> | null = null
  private abortController: AbortController | null = null

  constructor(
    private readonly settingsStore: JsonStore<AppSettings>,
    dependencies: Partial<EnvironmentManagerDependencies> = {}
  ) {
    this.dependencies = {
      nodeInstaller: new NodeInstaller(),
      piInstaller: new PiInstallService(),
      detectRuntime: detectNodeRuntime,
      detectEnvironment: (settings) =>
        piEnvironment.detect({
          cliPath: settings.manualCliPath,
          configDir: settings.manualConfigDir
        }),
      refreshPath: refreshRuntimePath,
      uuid: randomUUID,
      now: Date.now,
      onTask: () => undefined,
      onEnvironmentChanged: () => undefined,
      ...dependencies
    }
  }

  detect(): Promise<PiEnvironment> {
    return this.dependencies.detectEnvironment(this.settingsStore.peek())
  }

  checkLatest() {
    return this.dependencies.piInstaller.checkLatest()
  }

  getTask(): EnvironmentInstallTask | null {
    return this.task ? structuredClone(this.task) : null
  }

  async installNode(): Promise<EnvironmentInstallTask> {
    if (this.active) return this.active
    return this.runTask('node', async (signal) => {
      await this.installOrRepairNode(signal, 0, 100)
      const environment = await this.detectAndBroadcast()
      if (!environment.nodeRuntime.ready) {
        throw new EnvironmentError('NODE_INSTALL_FAILED', 'Node.js/npm verification failed')
      }
      return null
    })
  }

  installPi(): Promise<PiInstallResult> {
    return this.bootstrap(false)
  }

  async bootstrap(forcePi = false): Promise<PiInstallResult> {
    if (this.active) {
      const existing = await this.active
      if (existing.result) return existing.result
    }
    const task = await this.runTask('environment', async (signal) => {
      this.update('checking-environment', 2, 'Checking Node.js, npm, PATH, and Pi Coding Agent')
      let runtime = await this.dependencies.detectRuntime()
      if (!runtime.nodeInstalled) {
        this.appendLog(`Node.js was not found; installing Node.js >= ${MINIMUM_NODE_VERSION}`)
        await this.installOrRepairNode(signal, 4, 55)
      } else if (!runtime.nodeSupported) {
        this.appendLog(
          `Node.js ${runtime.nodeVersion ?? 'unknown'} is below ${MINIMUM_NODE_VERSION}; upgrading`
        )
        await this.installOrRepairNode(signal, 4, 55)
      } else if (!runtime.npmInstalled) {
        this.appendLog('npm is unavailable; repairing the managed Node.js runtime')
        await this.installOrRepairNode(signal, 4, 55)
      } else {
        this.update(
          'node-ready',
          20,
          `Using Node.js ${runtime.nodeVersion} and npm ${runtime.npmVersion}`
        )
      }

      await this.dependencies.refreshPath()
      runtime = await this.dependencies.detectRuntime()
      if (!runtime.nodeInstalled)
        throw new EnvironmentError('NODE_NOT_FOUND', 'Node.js was not found after installation')
      if (!runtime.nodeSupported) {
        throw new EnvironmentError(
          'NODE_VERSION_TOO_LOW',
          `Node.js ${runtime.nodeVersion ?? 'unknown'} is below ${MINIMUM_NODE_VERSION}`
        )
      }
      if (!runtime.npmInstalled)
        throw new EnvironmentError('NPM_NOT_FOUND', 'npm was not found after Node.js installation')

      const environment = await this.detect()
      const piHealthy = environment.installed && Boolean(environment.version)
      if (piHealthy && !forcePi) {
        this.update('pi-ready', 95, `Pi Coding Agent ${environment.version} is already installed`)
        const result = alreadyInstalledResult(environment.version)
        await this.detectAndBroadcast()
        return result
      }

      const installPi = () =>
        this.dependencies.piInstaller.install({
          force: forcePi || environment.installed,
          signal,
          onProgress: (progress) => this.mapPiProgress(progress),
          onLog: (message, level) => this.appendLog(message, level)
        })
      let result: PiInstallResult
      try {
        result = await installPi()
      } catch (error) {
        if (!(error instanceof AppError) || error.code !== 'NPM_NOT_FOUND') throw error
        this.appendLog(
          'npm disappeared during installation; repairing Node.js/npm and retrying',
          'warning'
        )
        await this.installOrRepairNode(signal, 55, 78)
        result = await installPi()
      }
      this.update('refreshing-environment', 99, 'Refreshing all Pi-Harness environment state')
      const verified = await this.detectAndBroadcast()
      if (!verified.installed || !verified.version) {
        throw new EnvironmentError(
          'PI_NOT_FOUND_AFTER_INSTALL',
          'Pi Coding Agent verification failed after environment refresh'
        )
      }
      return result
    })
    if (!task.result) throw new ValidationError('Environment task finished without a Pi result')
    return task.result
  }

  reinstallPi(): Promise<PiInstallResult> {
    return this.bootstrap(true)
  }

  async updatePi(force = false): Promise<PiInstallResult> {
    if (this.active) {
      const existing = await this.active
      if (existing.result) return existing.result
    }
    const task = await this.runTask('pi', async () => {
      this.update('updating-pi', 20, 'Updating Pi Coding Agent')
      const result = await this.dependencies.piInstaller.update(force)
      this.update('verifying-pi', 90, 'Verifying the updated Pi Coding Agent')
      await this.detectAndBroadcast()
      return result
    })
    if (!task.result) throw new ValidationError('Pi update finished without a result')
    return task.result
  }

  async cancel(): Promise<EnvironmentInstallTask | null> {
    if (!this.active || !this.abortController || !this.task) return this.getTask()
    this.appendLog('Cancellation requested', 'warning')
    this.task.cancellable = false
    this.emit()
    this.abortController.abort()
    await this.active.catch(() => undefined)
    return this.getTask()
  }

  private async installOrRepairNode(
    signal: AbortSignal,
    start: number,
    end: number
  ): Promise<void> {
    await this.dependencies.nodeInstaller.install({
      signal,
      onProgress: (progress) => this.mapNodeProgress(progress, start, end),
      onLog: (message) => this.appendLog(message)
    })
    await this.dependencies.refreshPath()
  }

  private runTask(
    type: EnvironmentInstallTaskType,
    operation: (signal: AbortSignal) => Promise<PiInstallResult | null>
  ): Promise<EnvironmentInstallTask> {
    if (this.active) return this.active
    const now = this.dependencies.now()
    this.abortController = new AbortController()
    this.task = {
      id: this.dependencies.uuid(),
      type,
      state: 'running',
      phase: 'checking-environment',
      progress: 0,
      message: 'Preparing environment installation',
      logs: [],
      startedAt: now,
      finishedAt: null,
      cancellable: true,
      error: null,
      result: null
    }
    this.appendLog('Environment installation task started')
    const signal = this.abortController.signal
    const promise = operation(signal)
      .then(async (result) => {
        if (!this.task) throw new Error('Environment task state was lost')
        this.task.result = result
        this.task.state = 'success'
        this.task.phase = 'complete'
        this.task.progress = 100
        this.task.message = result?.message ?? 'Node.js and npm are ready'
        this.task.finishedAt = this.dependencies.now()
        this.task.cancellable = false
        this.appendLog(this.task.message)
        await this.detectAndBroadcast().catch(() => undefined)
        this.emit()
        return this.getTask()!
      })
      .catch(async (error) => {
        if (!this.task) throw error
        const cancelled = signal.aborted || isCancelled(error)
        this.task.state = cancelled ? 'cancelled' : 'failed'
        this.task.phase = cancelled ? 'cancelled' : 'failed'
        this.task.message = cancelled
          ? 'Environment installation was cancelled'
          : error instanceof Error
            ? error.message
            : String(error)
        this.task.error = cancelled
          ? toErrorPayload(new EnvironmentError('INSTALL_CANCELLED', this.task.message))
          : toErrorPayload(error)
        this.task.finishedAt = this.dependencies.now()
        this.task.cancellable = false
        this.appendLog(this.task.message, cancelled ? 'warning' : 'error')
        await this.detectAndBroadcast().catch(() => undefined)
        this.emit()
        throw error
      })
      .finally(() => {
        this.active = null
        this.abortController = null
      })
    this.active = promise
    return promise
  }

  private mapNodeProgress(progress: NodeInstallProgress, start: number, end: number): void {
    const mapped = start + Math.round((progress.progress / 100) * (end - start))
    this.update(progress.phase, mapped, progress.message)
  }

  private mapPiProgress(progress: PiInstallProgress): void {
    const mapped = 55 + Math.round((progress.progress / 100) * 43)
    this.update(progress.phase, mapped, progress.message)
  }

  private update(phase: string, progress: number, message: string): void {
    if (!this.task) return
    this.task.phase = phase
    this.task.progress = Math.max(this.task.progress, Math.min(100, Math.round(progress)))
    this.task.message = message
    this.emit()
  }

  private appendLog(message: string, level: EnvironmentInstallLog['level'] = 'info'): void {
    if (!this.task) return
    const lines = sanitize(message)
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean)
    for (const line of lines) {
      this.task.logs.push({ at: this.dependencies.now(), level, message: line })
    }
    if (this.task.logs.length > 800) this.task.logs.splice(0, this.task.logs.length - 800)
    this.emit()
  }

  private emit(): void {
    if (!this.task) return
    this.dependencies.onTask(this.getTask()!)
  }

  private async detectAndBroadcast(): Promise<PiEnvironment> {
    piProcess.invalidateCache()
    const environment = await this.detect()
    this.dependencies.onEnvironmentChanged(environment)
    return environment
  }
}

function alreadyInstalledResult(version: string | null): PiInstallResult {
  return {
    ok: true,
    action: 'install',
    previousVersion: version,
    currentVersion: version,
    latestVersion: null,
    message: `Pi is already installed (${version ?? 'version unknown'})`,
    log: 'Skipped npm install because `pi --version` already succeeds.'
  }
}

function sanitize(value: string): string {
  return value.replace(/(?:sk-[a-zA-Z0-9-]{6,}|Bearer\s+[^\s]+)/gi, '[redacted]')
}

function isCancelled(error: unknown): boolean {
  return error instanceof AppError && error.code === 'INSTALL_CANCELLED'
}

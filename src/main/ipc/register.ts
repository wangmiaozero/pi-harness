/**
 * IPC handler registration — all channels validated; errors become AppErrorPayload.
 */

import { BrowserWindow, ipcMain, shell, clipboard, app } from 'electron'
import { IPC_EVENT, IPC_INVOKE } from '@shared/ipc/channels'
import { toErrorPayload } from '../services/errors'
import { log } from '../services/logger'
import { APP_VERSION } from '@shared/constants/index'
import type { AppSettings } from '@shared/ipc/api-types'
import type { JsonStore } from '../services/storage'
import type { PiConfigService } from '../pi/config-service'
import type { ProviderService } from '../services/provider-service'
import type { ModelService } from '../services/model-service'
import type { BackupService } from '../backup/backup-service'
import type { SkillsService } from '../services/skills-service'
import type { DiagnosticsService } from '../services/diagnostics-service'
import { piEnvironment } from '../pi/environment'
import { piProcess } from '../process/pi-process'
import { piInstall } from '../pi/install-service'
import { logFilePath } from '../services/app-paths'
import { readTextFile } from '../services/storage'
import { testConnectionSchema, skillFormSchema, skillImportSchema } from '@shared/schemas/domain'
import { ValidationError } from '../services/errors'
import { checkForUpdates, downloadUpdate, installUpdate } from '../updater'

export interface Services {
  settingsStore: JsonStore<AppSettings>
  uiStateStore: JsonStore<Record<string, unknown>>
  config: PiConfigService
  providers: ProviderService
  models: ModelService
  backup: BackupService
  skills: SkillsService
  diagnostics: DiagnosticsService
}

function wrap<T>(
  fn: () => Promise<T>
): Promise<{ ok: true; data: T } | { ok: false; error: ReturnType<typeof toErrorPayload> }> {
  return fn()
    .then((data) => ({ ok: true as const, data }))
    .catch((err) => {
      const payload = toErrorPayload(err)
      log.ipc.error('handler failed:', payload.message, payload)
      return { ok: false as const, error: payload }
    })
}

export function registerIpc(services: Services): void {
  const { settingsStore, uiStateStore, config, providers, models, backup, skills, diagnostics } =
    services

  // ---- system ----
  ipcMain.handle(IPC_INVOKE.systemInfo, () =>
    wrap(async () => ({
      platform: process.platform,
      arch: process.arch,
      versions: {
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node
      },
      appVersion: APP_VERSION,
      packaged: app.isPackaged
    }))
  )
  ipcMain.handle(IPC_INVOKE.systemOpenPath, (_e, p: string) =>
    wrap(async () => {
      await shell.openPath(p)
    })
  )
  ipcMain.handle(IPC_INVOKE.systemShowItem, (_e, p: string) =>
    wrap(async () => {
      shell.showItemInFolder(p)
    })
  )

  // ---- pi ----
  ipcMain.handle(IPC_INVOKE.piDetect, () =>
    wrap(async () => {
      const s = settingsStore.peek()
      return piEnvironment.detect({ cliPath: s.manualCliPath, configDir: s.manualConfigDir })
    })
  )
  ipcMain.handle(IPC_INVOKE.piGetVersion, () =>
    wrap(async () => {
      const s = settingsStore.peek()
      const cli = await piProcess.resolveCliPath(s.manualCliPath)
      const version = cli ? await piProcess.version() : null
      return { cli, version }
    })
  )
  ipcMain.handle(IPC_INVOKE.piRunHelp, () => wrap(() => piProcess.help()))
  ipcMain.handle(IPC_INVOKE.piCheckLatest, () => wrap(() => piInstall.checkLatest()))
  ipcMain.handle(IPC_INVOKE.piInstall, () => wrap(() => piInstall.install()))
  ipcMain.handle(IPC_INVOKE.piUpdate, (_e, force?: boolean) =>
    wrap(() => piInstall.update(Boolean(force)))
  )

  // ---- providers ----
  ipcMain.handle(IPC_INVOKE.providerList, () => wrap(() => providers.list()))
  ipcMain.handle(IPC_INVOKE.providerGet, (_e, key: string) => wrap(() => providers.get(key)))
  ipcMain.handle(
    IPC_INVOKE.providerCreate,
    (_e, form: unknown, options?: { overwrite?: boolean }) =>
      wrap(() => providers.create(form, options))
  )
  ipcMain.handle(
    IPC_INVOKE.providerUpdate,
    (_e, key: string, form: unknown, options?: { overwrite?: boolean }) =>
      wrap(() => providers.update(key, form, options))
  )
  ipcMain.handle(IPC_INVOKE.providerDelete, (_e, key: string, options?: { overwrite?: boolean }) =>
    wrap(() => providers.delete(key, options))
  )
  ipcMain.handle(
    IPC_INVOKE.providerDuplicate,
    (_e, key: string, options?: { overwrite?: boolean }) =>
      wrap(() => providers.duplicate(key, options))
  )
  ipcMain.handle(IPC_INVOKE.providerSetEnabled, (_e, key: string, enabled: boolean) =>
    wrap(() => providers.setEnabled(key, Boolean(enabled)))
  )
  ipcMain.handle(IPC_INVOKE.providerTestConnection, (_e, input: unknown) =>
    wrap(async () => {
      const r = testConnectionSchema.safeParse(input)
      if (!r.success) throw new ValidationError('Invalid test input', { issues: r.error.issues })
      return providers.testConnection(r.data)
    })
  )

  // ---- models ----
  ipcMain.handle(IPC_INVOKE.modelList, () => wrap(() => models.list()))
  ipcMain.handle(IPC_INVOKE.modelCreate, (_e, form: unknown, options?: { overwrite?: boolean }) =>
    wrap(() => models.create(form, options))
  )
  ipcMain.handle(
    IPC_INVOKE.modelUpdate,
    (_e, id: string, form: unknown, options?: { overwrite?: boolean }) =>
      wrap(() => models.update(id, form, options))
  )
  ipcMain.handle(IPC_INVOKE.modelDelete, (_e, id: string, options?: { overwrite?: boolean }) =>
    wrap(() => models.delete(id, options))
  )
  ipcMain.handle(
    IPC_INVOKE.modelSetActive,
    (_e, input: unknown, options?: { overwrite?: boolean }) =>
      wrap(() => models.setActive(input, options))
  )
  ipcMain.handle(IPC_INVOKE.modelGetActive, () => wrap(() => models.getActive()))

  // ---- config ----
  ipcMain.handle(IPC_INVOKE.configRead, () =>
    wrap(async () => {
      const raw = await config.readRaw('models')
      return raw
    })
  )
  ipcMain.handle(IPC_INVOKE.configReadRaw, (_e, file: 'models' | 'settings') =>
    wrap(() => config.readRaw(file))
  )
  ipcMain.handle(
    IPC_INVOKE.configWriteRaw,
    (_e, file: 'models' | 'settings', content: string, options?: { overwrite?: boolean }) =>
      wrap(async () => {
        if (file === 'models')
          await config.writeModelsRaw(content, { overwrite: options?.overwrite })
        else await config.writeSettingsRaw(content, { overwrite: options?.overwrite })
      })
  )
  ipcMain.handle(IPC_INVOKE.configReadSettings, () => wrap(() => config.readRaw('settings')))
  ipcMain.handle(IPC_INVOKE.configReload, () =>
    wrap(async () => {
      await config.read()
      return config.getStatus()
    })
  )
  ipcMain.handle(IPC_INVOKE.configGetStatus, () => wrap(() => config.getStatus()))
  ipcMain.handle(IPC_INVOKE.configConflictSnapshot, (_e, file: 'models' | 'settings') =>
    wrap(() => config.getConflictSnapshot(file))
  )

  // ---- skills ----
  ipcMain.handle(IPC_INVOKE.skillsList, () => wrap(() => skills.list()))
  ipcMain.handle(IPC_INVOKE.skillRead, (_e, p: string) => wrap(() => skills.read(p)))
  ipcMain.handle(IPC_INVOKE.skillCreate, (_e, form: unknown) =>
    wrap(() => {
      const r = skillFormSchema.safeParse(form)
      if (!r.success) throw new ValidationError('Invalid skill form', { issues: r.error.issues })
      return skills.create(r.data)
    })
  )
  ipcMain.handle(IPC_INVOKE.skillUpdate, (_e, form: unknown) =>
    wrap(() => {
      const r = skillFormSchema.safeParse(form)
      if (!r.success) throw new ValidationError('Invalid skill form', { issues: r.error.issues })
      return skills.update(r.data)
    })
  )
  ipcMain.handle(IPC_INVOKE.skillImport, (_e, input: unknown) =>
    wrap(() => {
      const r = skillImportSchema.safeParse(input)
      if (!r.success) throw new ValidationError('Invalid import input', { issues: r.error.issues })
      return skills.import(r.data)
    })
  )
  ipcMain.handle(IPC_INVOKE.skillValidate, (_e, form: unknown) =>
    wrap(async () => {
      const r = skillFormSchema.safeParse(form)
      if (!r.success) {
        return {
          valid: false,
          issues: r.error.issues.map((i) => ({ level: 'error' as const, message: i.message }))
        }
      }
      return skills.validate(r.data)
    })
  )
  ipcMain.handle(IPC_INVOKE.skillDelete, (_e, p: string) => wrap(() => skills.delete(p)))
  ipcMain.handle(IPC_INVOKE.skillsRefresh, () => wrap(() => skills.list()))

  // ---- backup ----
  ipcMain.handle(IPC_INVOKE.backupList, () => wrap(() => backup.list()))
  ipcMain.handle(IPC_INVOKE.backupCreate, (_e, reason?: string) =>
    wrap(() => backup.create(reason ?? 'manual'))
  )
  ipcMain.handle(IPC_INVOKE.backupRestore, (_e, id: string) => wrap(() => backup.restore(id)))
  ipcMain.handle(IPC_INVOKE.backupDelete, (_e, id: string) => wrap(() => backup.delete(id)))
  ipcMain.handle(IPC_INVOKE.backupPurgeOlderThanToday, () =>
    wrap(() => backup.purgeOlderThanToday())
  )
  ipcMain.handle(IPC_INVOKE.backupOpenFolder, () =>
    wrap(async () => {
      const folder = await backup.openFolder()
      await shell.openPath(folder)
    })
  )

  // ---- settings ----
  ipcMain.handle(IPC_INVOKE.settingsGet, () => wrap(() => settingsStore.read()))
  ipcMain.handle(IPC_INVOKE.settingsSet, (_e, patch: Partial<AppSettings>) =>
    wrap(() => settingsStore.update(patch))
  )
  ipcMain.handle(IPC_INVOKE.uiStateGet, () => wrap(() => uiStateStore.read()))
  ipcMain.handle(IPC_INVOKE.uiStateSet, (_e, state: Record<string, unknown>) =>
    wrap(() => uiStateStore.write(state))
  )

  // ---- diagnostics ----
  ipcMain.handle(IPC_INVOKE.diagnosticsGet, () => wrap(() => diagnostics.get()))
  ipcMain.handle(IPC_INVOKE.diagnosticsCopy, () =>
    wrap(async () => {
      const text = await diagnostics.copyText()
      clipboard.writeText(text)
      return text
    })
  )
  ipcMain.handle(IPC_INVOKE.diagnosticsExport, () => wrap(() => diagnostics.export()))

  // ---- logs ----
  ipcMain.handle(IPC_INVOKE.logsRead, () =>
    wrap(async () => (await readTextFile(logFilePath())) ?? '')
  )
  ipcMain.handle(IPC_INVOKE.logsOpenFolder, () =>
    wrap(async () => {
      shell.showItemInFolder(logFilePath())
    })
  )

  // ---- updater ----
  ipcMain.handle(IPC_INVOKE.updaterCheck, () => wrap(() => checkForUpdates()))
  ipcMain.handle(IPC_INVOKE.updaterDownload, () => wrap(() => downloadUpdate()))
  ipcMain.handle(IPC_INVOKE.updaterInstall, () => wrap(() => installUpdate()))

  // ---- window ----
  ipcMain.handle(IPC_INVOKE.windowMinimize, (e) =>
    wrap(async () => {
      BrowserWindow.fromWebContents(e.sender)?.minimize()
    })
  )
  ipcMain.handle(IPC_INVOKE.windowMaximizeToggle, (e) =>
    wrap(async () => {
      const win = BrowserWindow.fromWebContents(e.sender)
      if (!win) return
      if (win.isMaximized()) win.unmaximize()
      else win.maximize()
    })
  )
  ipcMain.handle(IPC_INVOKE.windowClose, (e) =>
    wrap(async () => {
      BrowserWindow.fromWebContents(e.sender)?.close()
    })
  )

  void app
}

export function broadcastConfigChanged(win: BrowserWindow | null): void {
  win?.webContents.send(IPC_EVENT.configChanged, { at: Date.now() })
}

export function broadcastNotification(
  win: BrowserWindow | null,
  payload: { level: string; title: string; message?: string }
): void {
  win?.webContents.send(IPC_EVENT.notification, payload)
}

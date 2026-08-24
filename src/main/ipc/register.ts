/**
 * IPC handler registration — all channels validated; errors become AppErrorPayload.
 */

import {
  BrowserWindow,
  ipcMain as electronIpcMain,
  shell,
  clipboard,
  app,
  nativeTheme
} from 'electron'
import { IPC_EVENT, IPC_INVOKE } from '@shared/ipc/channels'
import { NODE_DOWNLOAD_URL, PI_INSTALL_COMMAND } from '@shared/constants/pi-install'
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
import { piProcess } from '../process/pi-process'
import { logFilePath } from '../services/app-paths'
import { readTextFile } from '../services/storage'
import {
  builtinSkillMutationTargetSchema,
  optionalProjectRootSchema,
  piPackageTargetSchema,
  piPackageTargetsSchema,
  testConnectionSchema,
  skillFormSchema,
  skillImportSchema
} from '@shared/schemas/domain'
import { SecurityError, ValidationError } from '../services/errors'
import { checkForUpdates, downloadUpdate, getUpdateState, installUpdate } from '../updater'
import { registerWorkspaceIpc, type WorkspaceServices } from './register-workspace'
import { createTrustedIpcMain } from './trusted-ipc'
import type { CapabilityService } from '../capabilities/capability-service'
import { capabilityMutationSchema, capabilityToggleSchema } from '@shared/capabilities/schema'
import type { EnvironmentManager } from '../environment/environment-manager'
import { DEFAULT_MASCOT_STYLE, isMascotUnlockAnswer } from '@shared/constants/mascot'

export interface Services {
  settingsStore: JsonStore<AppSettings>
  uiStateStore: JsonStore<Record<string, unknown>>
  config: PiConfigService
  providers: ProviderService
  models: ModelService
  backup: BackupService
  skills: SkillsService
  capabilities: CapabilityService
  diagnostics: DiagnosticsService
  environment: EnvironmentManager
  workspace: WorkspaceServices
  getMainWindow: () => BrowserWindow | null
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
  const {
    settingsStore,
    uiStateStore,
    config,
    providers,
    models,
    backup,
    skills,
    capabilities,
    diagnostics,
    environment
  } = services
  const ipcMain = createTrustedIpcMain(electronIpcMain, services.getMainWindow, () =>
    wrap(async () => {
      throw new SecurityError('Untrusted IPC sender')
    })
  )

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
  ipcMain.handle(IPC_INVOKE.piDetect, () => wrap(() => environment.detect()))
  ipcMain.handle(IPC_INVOKE.piGetVersion, () =>
    wrap(async () => {
      const s = settingsStore.peek()
      const cli = await piProcess.resolveCliPath(s.manualCliPath)
      const version = cli ? await piProcess.version() : null
      return { cli, version }
    })
  )
  ipcMain.handle(IPC_INVOKE.piRunHelp, () => wrap(() => piProcess.help()))
  ipcMain.handle(IPC_INVOKE.piCheckLatest, () => wrap(() => environment.checkLatest()))
  ipcMain.handle(IPC_INVOKE.piInstall, () => wrap(() => environment.installPi()))
  ipcMain.handle(IPC_INVOKE.piBootstrap, () => wrap(() => environment.bootstrap()))
  ipcMain.handle(IPC_INVOKE.piInstallNode, () => wrap(() => environment.installNode()))
  ipcMain.handle(IPC_INVOKE.piReinstall, () => wrap(() => environment.reinstallPi()))
  ipcMain.handle(IPC_INVOKE.piGetInstallTask, () => wrap(async () => environment.getTask()))
  ipcMain.handle(IPC_INVOKE.piCancelInstall, () => wrap(() => environment.cancel()))
  ipcMain.handle(IPC_INVOKE.piUpdate, (_e, force?: boolean) =>
    wrap(() => environment.updatePi(Boolean(force)))
  )
  ipcMain.handle(IPC_INVOKE.piCopyInstallCommand, () =>
    wrap(async () => {
      clipboard.writeText(PI_INSTALL_COMMAND)
      return PI_INSTALL_COMMAND
    })
  )
  ipcMain.handle(IPC_INVOKE.piOpenNodeDownload, () =>
    wrap(async () => {
      await shell.openExternal(NODE_DOWNLOAD_URL)
    })
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
  const parseProjectRoot = (input: unknown): string | null | undefined => {
    const parsed = optionalProjectRootSchema.safeParse(input)
    if (!parsed.success) throw new ValidationError('Invalid project root')
    return parsed.data
  }
  const parsePackageTarget = (input: unknown) => {
    const parsed = piPackageTargetSchema.safeParse(input)
    if (!parsed.success) {
      throw new ValidationError('Invalid package target', { issues: parsed.error.issues })
    }
    return parsed.data
  }
  const notifyPackageMutation = <T>(operation: () => Promise<T>): Promise<T> =>
    operation().then((result) => {
      broadcastConfigChanged(services.getMainWindow())
      return result
    })

  ipcMain.handle(IPC_INVOKE.skillsList, (_e, projectRoot: unknown) =>
    wrap(() => skills.list(parseProjectRoot(projectRoot)))
  )
  ipcMain.handle(IPC_INVOKE.skillsPackages, (_e, projectRoot: unknown) =>
    wrap(() => skills.listPackages(parseProjectRoot(projectRoot)))
  )
  ipcMain.handle(IPC_INVOKE.skillsMarket, (_e, projectRoot: unknown) =>
    wrap(() => skills.listMarket(parseProjectRoot(projectRoot)))
  )
  const parseBuiltinSkillTarget = (input: unknown) => {
    const parsed = builtinSkillMutationTargetSchema.safeParse(input)
    if (!parsed.success) {
      throw new ValidationError('Invalid built-in Skill target', { issues: parsed.error.issues })
    }
    return parsed.data
  }
  ipcMain.handle(IPC_INVOKE.skillsInstallBuiltin, (_e, target: unknown) =>
    wrap(() =>
      notifyPackageMutation(() => skills.installBuiltinSkills(parseBuiltinSkillTarget(target)))
    )
  )
  ipcMain.handle(IPC_INVOKE.skillsUpdateBuiltin, (_e, target: unknown) =>
    wrap(() =>
      notifyPackageMutation(() => skills.updateBuiltinSkills(parseBuiltinSkillTarget(target)))
    )
  )
  ipcMain.handle(IPC_INVOKE.skillsUninstallBuiltin, (_e, target: unknown) =>
    wrap(() =>
      notifyPackageMutation(() => skills.uninstallBuiltinSkills(parseBuiltinSkillTarget(target)))
    )
  )
  ipcMain.handle(IPC_INVOKE.skillsInstallPackages, (_e, targets: unknown) =>
    wrap(() => {
      const parsed = piPackageTargetsSchema.safeParse(targets)
      if (!parsed.success) {
        throw new ValidationError('Invalid package targets', { issues: parsed.error.issues })
      }
      return notifyPackageMutation(() => skills.installPackages(parsed.data))
    })
  )
  ipcMain.handle(IPC_INVOKE.skillsRepairPackage, (_e, target: unknown) =>
    wrap(() => notifyPackageMutation(() => skills.repairPackage(parsePackageTarget(target))))
  )
  ipcMain.handle(IPC_INVOKE.skillsRegisterPackage, (_e, target: unknown) =>
    wrap(() => notifyPackageMutation(() => skills.registerPackage(parsePackageTarget(target))))
  )
  ipcMain.handle(IPC_INVOKE.skillsRemovePackages, (_e, targets: unknown) =>
    wrap(() => {
      const parsed = piPackageTargetsSchema.safeParse(targets)
      if (!parsed.success) {
        throw new ValidationError('Invalid package targets', { issues: parsed.error.issues })
      }
      return notifyPackageMutation(() => skills.removePackages(parsed.data))
    })
  )
  ipcMain.handle(IPC_INVOKE.skillsRemovePackage, (_e, target: unknown) =>
    wrap(() => notifyPackageMutation(() => skills.removePackage(parsePackageTarget(target))))
  )
  ipcMain.handle(IPC_INVOKE.skillsDeleteOrphanPackage, (_e, target: unknown) =>
    wrap(() => notifyPackageMutation(() => skills.deleteOrphanPackage(parsePackageTarget(target))))
  )
  ipcMain.handle(IPC_INVOKE.skillsCleanupPlan, (_e, projectRoot: unknown) =>
    wrap(() => skills.cleanupPlan(parseProjectRoot(projectRoot)))
  )
  ipcMain.handle(IPC_INVOKE.skillsCleanupThirdParty, (_e, projectRoot: unknown) =>
    wrap(() => notifyPackageMutation(() => skills.cleanupThirdParty(parseProjectRoot(projectRoot))))
  )
  ipcMain.handle(IPC_INVOKE.skillsRepairPermissions, (_e, projectRoot: unknown) =>
    wrap(() => notifyPackageMutation(() => skills.repairPermissions(parseProjectRoot(projectRoot))))
  )
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
  ipcMain.handle(IPC_INVOKE.skillsRefresh, (_e, projectRoot: unknown) =>
    wrap(() => skills.list(parseProjectRoot(projectRoot)))
  )

  // ---- capabilities ----
  capabilities.onProgress((progress) => {
    const window = services.getMainWindow()
    if (window && !window.isDestroyed()) {
      window.webContents.send(IPC_EVENT.capabilityProgress, progress)
    }
  })
  ipcMain.handle(IPC_INVOKE.capabilitiesList, () => wrap(() => capabilities.list()))
  ipcMain.handle(IPC_INVOKE.capabilityInstallSkill, (_e, input: unknown) =>
    wrap(() => {
      const parsed = capabilityMutationSchema.safeParse(input)
      if (!parsed.success) {
        throw new ValidationError('Invalid capability install input', {
          issues: parsed.error.issues
        })
      }
      return capabilities.install(parsed.data.skillId)
    })
  )
  ipcMain.handle(IPC_INVOKE.capabilityUpdateSkill, (_e, input: unknown) =>
    wrap(() => {
      const parsed = capabilityMutationSchema.safeParse(input)
      if (!parsed.success) {
        throw new ValidationError('Invalid capability update input', {
          issues: parsed.error.issues
        })
      }
      return capabilities.update(parsed.data.skillId)
    })
  )
  ipcMain.handle(IPC_INVOKE.capabilityUninstallSkill, (_e, input: unknown) =>
    wrap(() => {
      const parsed = capabilityMutationSchema.safeParse(input)
      if (!parsed.success) {
        throw new ValidationError('Invalid capability uninstall input', {
          issues: parsed.error.issues
        })
      }
      return capabilities.uninstall(parsed.data.skillId)
    })
  )
  ipcMain.handle(IPC_INVOKE.capabilitySetSkillEnabled, (_e, input: unknown) =>
    wrap(() => {
      const parsed = capabilityToggleSchema.safeParse(input)
      if (!parsed.success) {
        throw new ValidationError('Invalid capability enable input', {
          issues: parsed.error.issues
        })
      }
      return capabilities.setEnabled(parsed.data.skillId, parsed.data.enabled)
    })
  )

  // ---- backup ----
  ipcMain.handle(IPC_INVOKE.backupList, () => wrap(() => backup.list()))
  ipcMain.handle(IPC_INVOKE.backupCreate, (_e, reason?: string) =>
    wrap(() => backup.create(reason ?? 'manual'))
  )
  ipcMain.handle(IPC_INVOKE.backupRestore, (_e, id: string) => wrap(() => backup.restore(id)))
  ipcMain.handle(IPC_INVOKE.backupDelete, (_e, id: string) => wrap(() => backup.delete(id)))
  ipcMain.handle(IPC_INVOKE.backupPruneToRetention, (_e, retention: number) =>
    wrap(() => backup.pruneToRetention(retention))
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
    wrap(async () => {
      const current = await settingsStore.read()
      const nextPatch = { ...patch }
      if (!current.mascotUnlocked) nextPatch.mascotUnlocked = false
      const mascotUnlocked = current.mascotUnlocked && nextPatch.mascotUnlocked !== false
      if (!mascotUnlocked) {
        nextPatch.mascotUnlocked = false
        nextPatch.mascotStyle = DEFAULT_MASCOT_STYLE
        nextPatch.petEnabled = false
      }
      const settings = await settingsStore.update(nextPatch)
      nativeTheme.themeSource = settings.theme
      return settings
    })
  )
  ipcMain.handle(IPC_INVOKE.settingsUnlockMascot, (_e, answer: unknown) =>
    wrap(async () => {
      if (typeof answer !== 'string' || answer.length > 64 || !isMascotUnlockAnswer(answer)) {
        return false
      }
      await settingsStore.update({ mascotUnlocked: true })
      return true
    })
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
  ipcMain.handle(IPC_INVOKE.updaterState, () => wrap(async () => getUpdateState()))
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

  registerWorkspaceIpc(ipcMain, wrap, services.workspace)

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

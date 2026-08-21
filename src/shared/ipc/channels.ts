/**
 * IPC channel contract — single source of truth for channel names.
 *
 * The renderer never writes channel strings directly. The preload bridge
 * (contextBridge) exposes a typed `window.piSwitch` object whose methods map
 * to these channels. Channel names live here so main, preload and renderer
 * share one definition.
 */

const invoke = (name: string) => `pi-harness:${name}` as const

export const IPC_INVOKE = {
  // system
  systemInfo: invoke('system:info'),
  systemOpenPath: invoke('system:open-path'),
  systemShowItem: invoke('system:show-item'),

  // pi environment
  piDetect: invoke('pi:detect'),
  piGetVersion: invoke('pi:get-version'),
  piRunHelp: invoke('pi:run-help'),
  piCheckLatest: invoke('pi:check-latest'),
  piInstall: invoke('pi:install'),
  piUpdate: invoke('pi:update'),

  // providers
  providerList: invoke('providers:list'),
  providerGet: invoke('providers:get'),
  providerCreate: invoke('providers:create'),
  providerUpdate: invoke('providers:update'),
  providerDelete: invoke('providers:delete'),
  providerDuplicate: invoke('providers:duplicate'),
  providerSetEnabled: invoke('providers:set-enabled'),
  providerTestConnection: invoke('providers:test-connection'),

  // models
  modelList: invoke('models:list'),
  modelCreate: invoke('models:create'),
  modelUpdate: invoke('models:update'),
  modelDelete: invoke('models:delete'),
  modelSetActive: invoke('models:set-active'),
  modelGetActive: invoke('models:get-active'),

  // config (Pi native config service)
  configRead: invoke('config:read'),
  configReadRaw: invoke('config:read-raw'),
  configWriteRaw: invoke('config:write-raw'),
  configReadSettings: invoke('config:read-settings'),
  configReload: invoke('config:reload'),
  configGetStatus: invoke('config:get-status'),
  configConflictSnapshot: invoke('config:conflict-snapshot'),

  // skills
  skillsList: invoke('skills:list'),
  skillsPackages: invoke('skills:packages'),
  skillsMarket: invoke('skills:market'),
  skillsInstallPackages: invoke('skills:install-packages'),
  skillsRemovePackage: invoke('skills:remove-package'),
  skillRead: invoke('skills:read'),
  skillCreate: invoke('skills:create'),
  skillUpdate: invoke('skills:update'),
  skillImport: invoke('skills:import'),
  skillValidate: invoke('skills:validate'),
  skillDelete: invoke('skills:delete'),
  skillsRefresh: invoke('skills:refresh'),

  // backups
  backupList: invoke('backup:list'),
  backupCreate: invoke('backup:create'),
  backupRestore: invoke('backup:restore'),
  backupDelete: invoke('backup:delete'),
  backupPruneToRetention: invoke('backup:prune-to-retention'),
  backupOpenFolder: invoke('backup:open-folder'),

  // settings (Pi-Harness app settings)
  settingsGet: invoke('settings:get'),
  settingsSet: invoke('settings:set'),
  uiStateGet: invoke('settings:ui-state-get'),
  uiStateSet: invoke('settings:ui-state-set'),

  // diagnostics
  diagnosticsGet: invoke('diagnostics:get'),
  diagnosticsCopy: invoke('diagnostics:copy'),
  diagnosticsExport: invoke('diagnostics:export'),

  // logs
  logsRead: invoke('logs:read'),
  logsOpenFolder: invoke('logs:open-folder'),

  // updater
  updaterCheck: invoke('updater:check'),
  updaterDownload: invoke('updater:download'),
  updaterInstall: invoke('updater:install'),

  // window
  windowMinimize: invoke('window:minimize'),
  windowMaximizeToggle: invoke('window:maximize-toggle'),
  windowClose: invoke('window:close')
} as const

/** Main → renderer push events (one-way, via webContents.send). */
export const IPC_EVENT = {
  configChanged: 'pi-harness:event:config-changed',
  piEnvironmentChanged: 'pi-harness:event:pi-env-changed',
  notification: 'pi-harness:event:notification'
} as const

export type IpcEventName = (typeof IPC_EVENT)[keyof typeof IPC_EVENT]

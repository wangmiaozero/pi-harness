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
  piBootstrap: invoke('pi:bootstrap'),
  piInstallNode: invoke('pi:install-node'),
  piReinstall: invoke('pi:reinstall'),
  piGetInstallTask: invoke('pi:get-install-task'),
  piCancelInstall: invoke('pi:cancel-install'),
  piUpdate: invoke('pi:update'),
  piCopyInstallCommand: invoke('pi:copy-install-command'),
  piOpenNodeDownload: invoke('pi:open-node-download'),

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
  skillsInstallBuiltin: invoke('skills:builtin:install'),
  skillsUpdateBuiltin: invoke('skills:builtin:update'),
  skillsUninstallBuiltin: invoke('skills:builtin:uninstall'),
  skillsInstallPackages: invoke('skills:install-packages'),
  skillsRepairPackage: invoke('skills:repair-package'),
  skillsRegisterPackage: invoke('skills:register-package'),
  skillsRemovePackages: invoke('skills:remove-packages'),
  skillsRemovePackage: invoke('skills:remove-package'),
  skillsDeleteOrphanPackage: invoke('skills:delete-orphan-package'),
  skillsCleanupPlan: invoke('skills:cleanup-plan'),
  skillsCleanupThirdParty: invoke('skills:cleanup-third-party'),
  skillsRepairPermissions: invoke('skills:repair-permissions'),
  skillRead: invoke('skills:read'),
  skillCreate: invoke('skills:create'),
  skillUpdate: invoke('skills:update'),
  skillImport: invoke('skills:import'),
  skillValidate: invoke('skills:validate'),
  skillDelete: invoke('skills:delete'),
  skillsRefresh: invoke('skills:refresh'),

  // unified capability layer (trusted catalog mutations only)
  capabilitiesList: invoke('capabilities:list'),
  capabilityInstallSkill: invoke('capabilities:skills:install'),
  capabilityUpdateSkill: invoke('capabilities:skills:update'),
  capabilityUninstallSkill: invoke('capabilities:skills:uninstall'),
  capabilitySetSkillEnabled: invoke('capabilities:skills:set-enabled'),

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
  settingsUnlockMascot: invoke('settings:unlock-mascot'),
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
  updaterState: invoke('updater:state'),
  updaterCheck: invoke('updater:check'),
  updaterDownload: invoke('updater:download'),
  updaterInstall: invoke('updater:install'),

  // window
  windowMinimize: invoke('window:minimize'),
  windowMaximizeToggle: invoke('window:maximize-toggle'),
  windowClose: invoke('window:close'),

  workspaceListProjects: invoke('workspace:list-projects'),
  workspacePickDirectory: invoke('workspace:pick-directory'),
  workspaceAllowRoot: invoke('workspace:allow-root'),
  workspaceProjectContextMenu: invoke('workspace:project-context-menu'),

  sessionList: invoke('session:list'),
  sessionGet: invoke('session:get'),
  sessionRename: invoke('session:rename'),
  sessionDelete: invoke('session:delete'),
  sessionContext: invoke('session:context'),
  sessionExport: invoke('session:export'),
  sessionViewHistory: invoke('session:view-history'),
  sessionContextMenu: invoke('session:context-menu'),

  agentStart: invoke('agent:start'),
  agentPrompt: invoke('agent:prompt'),
  agentAbort: invoke('agent:abort'),
  agentState: invoke('agent:state'),
  agentRunning: invoke('agent:running'),
  agentCommand: invoke('agent:command'),

  filesList: invoke('files:list'),
  filesRead: invoke('files:read'),
  filesWrite: invoke('files:write'),
  filesUpload: invoke('files:upload'),

  gitStatus: invoke('git:status'),
  gitDiff: invoke('git:diff'),

  worktreeList: invoke('worktree:list'),
  worktreeCreate: invoke('worktree:create'),
  worktreeRemove: invoke('worktree:remove')
} as const

/** Main → renderer push events (one-way, via webContents.send). */
export const IPC_EVENT = {
  configChanged: 'pi-harness:event:config-changed',
  piEnvironmentChanged: 'pi-harness:event:pi-env-changed',
  environmentInstallTask: 'pi-harness:event:environment-install-task',
  notification: 'pi-harness:event:notification',
  agentEvent: 'pi-harness:agent:event',
  agentRunning: 'pi-harness:agent:running',
  updaterState: 'pi-harness:updater:state',
  capabilityProgress: 'pi-harness:capabilities:mutation-progress'
} as const

export type IpcEventName = (typeof IPC_EVENT)[keyof typeof IPC_EVENT]

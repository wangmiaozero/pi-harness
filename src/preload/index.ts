/**
 * Preload bridge — exposes typed `window.piSwitch` via contextBridge.
 * Renderer never sees ipcRenderer or channel strings.
 */

import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { IPC_EVENT, IPC_INVOKE } from '../shared/ipc/channels'
import type { PiSwitchAPI, IpcEventListener } from '../shared/ipc/api-types'
import type { AppErrorPayload } from '../shared/types/errors'
import { API_NAMESPACE } from '../shared/constants/index'

type IpcResult<T> = { ok: true; data: T } | { ok: false; error: AppErrorPayload }

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, ...args)) as IpcResult<T>
  if (!result || typeof result !== 'object' || !('ok' in result)) {
    throw { code: 'IPC_ERROR', message: 'Malformed IPC response' } satisfies AppErrorPayload
  }
  if (!result.ok) {
    // contextBridge preserves structured-cloneable objects, but strips custom
    // properties attached to Error instances. Reject with the typed payload so
    // renderer conflict/error handling receives the original error code.
    throw result.error
  }
  return result.data
}

function onEvent(channel: string, listener: IpcEventListener): () => void {
  const handler = (_event: IpcRendererEvent, payload: unknown) => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: PiSwitchAPI = {
  system: {
    info: () => invoke(IPC_INVOKE.systemInfo),
    openPath: (path) => invoke(IPC_INVOKE.systemOpenPath, path),
    showItem: (path) => invoke(IPC_INVOKE.systemShowItem, path)
  },
  pi: {
    detect: () => invoke(IPC_INVOKE.piDetect),
    getVersion: () => invoke(IPC_INVOKE.piGetVersion),
    runHelp: () => invoke(IPC_INVOKE.piRunHelp),
    checkLatest: () => invoke(IPC_INVOKE.piCheckLatest),
    install: () => invoke(IPC_INVOKE.piInstall),
    bootstrap: () => invoke(IPC_INVOKE.piBootstrap),
    installNode: () => invoke(IPC_INVOKE.piInstallNode),
    reinstall: () => invoke(IPC_INVOKE.piReinstall),
    getInstallTask: () => invoke(IPC_INVOKE.piGetInstallTask),
    cancelInstall: () => invoke(IPC_INVOKE.piCancelInstall),
    update: (force) => invoke(IPC_INVOKE.piUpdate, force),
    copyInstallCommand: () => invoke(IPC_INVOKE.piCopyInstallCommand),
    openNodeDownload: () => invoke(IPC_INVOKE.piOpenNodeDownload)
  },
  providers: {
    list: () => invoke(IPC_INVOKE.providerList),
    get: (key) => invoke(IPC_INVOKE.providerGet, key),
    create: (form, options) => invoke(IPC_INVOKE.providerCreate, form, options ?? {}),
    update: (key, form, options) => invoke(IPC_INVOKE.providerUpdate, key, form, options ?? {}),
    delete: (key, options) => invoke(IPC_INVOKE.providerDelete, key, options ?? {}),
    duplicate: (key, options) => invoke(IPC_INVOKE.providerDuplicate, key, options ?? {}),
    setEnabled: (key, enabled) => invoke(IPC_INVOKE.providerSetEnabled, key, enabled),
    testConnection: (input) => invoke(IPC_INVOKE.providerTestConnection, input),
    discoverModels: (input) => invoke(IPC_INVOKE.providerDiscoverModels, input)
  },
  models: {
    list: () => invoke(IPC_INVOKE.modelList),
    create: (form, options) => invoke(IPC_INVOKE.modelCreate, form, options ?? {}),
    update: (id, form, options) => invoke(IPC_INVOKE.modelUpdate, id, form, options ?? {}),
    delete: (id, options) => invoke(IPC_INVOKE.modelDelete, id, options ?? {}),
    setActive: (input, options) => invoke(IPC_INVOKE.modelSetActive, input, options ?? {}),
    getActive: () => invoke(IPC_INVOKE.modelGetActive)
  },
  config: {
    read: () => invoke(IPC_INVOKE.configRead),
    readRaw: (file) => invoke(IPC_INVOKE.configReadRaw, file),
    writeRaw: (file, content, options) =>
      invoke(IPC_INVOKE.configWriteRaw, file, content, options ?? {}),
    readSettings: () => invoke(IPC_INVOKE.configReadSettings),
    reload: () => invoke(IPC_INVOKE.configReload),
    getStatus: () => invoke(IPC_INVOKE.configGetStatus),
    conflictSnapshot: (file) => invoke(IPC_INVOKE.configConflictSnapshot, file)
  },
  skills: {
    list: (projectRoot) => invoke(IPC_INVOKE.skillsList, projectRoot),
    packages: (projectRoot) => invoke(IPC_INVOKE.skillsPackages, projectRoot),
    market: (projectRoot) => invoke(IPC_INVOKE.skillsMarket, projectRoot),
    installBuiltinSkills: (target) => invoke(IPC_INVOKE.skillsInstallBuiltin, target),
    updateBuiltinSkills: (target) => invoke(IPC_INVOKE.skillsUpdateBuiltin, target),
    uninstallBuiltinSkills: (target) => invoke(IPC_INVOKE.skillsUninstallBuiltin, target),
    installPackages: (targets) => invoke(IPC_INVOKE.skillsInstallPackages, targets),
    repairPackage: (target) => invoke(IPC_INVOKE.skillsRepairPackage, target),
    registerPackage: (target) => invoke(IPC_INVOKE.skillsRegisterPackage, target),
    removePackages: (targets) => invoke(IPC_INVOKE.skillsRemovePackages, targets),
    removePackage: (target) => invoke(IPC_INVOKE.skillsRemovePackage, target),
    deleteOrphanPackage: (target) => invoke(IPC_INVOKE.skillsDeleteOrphanPackage, target),
    cleanupPlan: (projectRoot) => invoke(IPC_INVOKE.skillsCleanupPlan, projectRoot),
    cleanupThirdParty: (projectRoot) => invoke(IPC_INVOKE.skillsCleanupThirdParty, projectRoot),
    repairPermissions: (projectRoot) => invoke(IPC_INVOKE.skillsRepairPermissions, projectRoot),
    read: (path) => invoke(IPC_INVOKE.skillRead, path),
    create: (form) => invoke(IPC_INVOKE.skillCreate, form),
    update: (form) => invoke(IPC_INVOKE.skillUpdate, form),
    import: (input) => invoke(IPC_INVOKE.skillImport, input),
    validate: (form) => invoke(IPC_INVOKE.skillValidate, form),
    delete: (path) => invoke(IPC_INVOKE.skillDelete, path),
    refresh: () => invoke(IPC_INVOKE.skillsRefresh)
  },
  capabilities: {
    list: () => invoke(IPC_INVOKE.capabilitiesList),
    installSkill: (skillId) => invoke(IPC_INVOKE.capabilityInstallSkill, { skillId }),
    updateSkill: (skillId) => invoke(IPC_INVOKE.capabilityUpdateSkill, { skillId }),
    uninstallSkill: (skillId) => invoke(IPC_INVOKE.capabilityUninstallSkill, { skillId }),
    setSkillEnabled: (skillId, enabled) =>
      invoke(IPC_INVOKE.capabilitySetSkillEnabled, { skillId, enabled })
  },
  backup: {
    list: () => invoke(IPC_INVOKE.backupList),
    create: (reason) => invoke(IPC_INVOKE.backupCreate, reason),
    restore: (id) => invoke(IPC_INVOKE.backupRestore, id),
    delete: (id) => invoke(IPC_INVOKE.backupDelete, id),
    pruneToRetention: (retention) => invoke(IPC_INVOKE.backupPruneToRetention, retention),
    openFolder: () => invoke(IPC_INVOKE.backupOpenFolder)
  },
  settings: {
    get: () => invoke(IPC_INVOKE.settingsGet),
    set: (patch) => invoke(IPC_INVOKE.settingsSet, patch),
    unlockMascot: (answer) => invoke(IPC_INVOKE.settingsUnlockMascot, answer),
    getUiState: () => invoke(IPC_INVOKE.uiStateGet),
    setUiState: (state) => invoke(IPC_INVOKE.uiStateSet, state)
  },
  diagnostics: {
    get: () => invoke(IPC_INVOKE.diagnosticsGet),
    copy: () => invoke(IPC_INVOKE.diagnosticsCopy),
    export: () => invoke(IPC_INVOKE.diagnosticsExport)
  },
  logs: {
    read: () => invoke(IPC_INVOKE.logsRead),
    openFolder: () => invoke(IPC_INVOKE.logsOpenFolder)
  },
  updater: {
    state: () => invoke(IPC_INVOKE.updaterState),
    check: () => invoke(IPC_INVOKE.updaterCheck),
    download: () => invoke(IPC_INVOKE.updaterDownload),
    install: () => invoke(IPC_INVOKE.updaterInstall)
  },
  window: {
    minimize: () => invoke(IPC_INVOKE.windowMinimize),
    maximizeToggle: () => invoke(IPC_INVOKE.windowMaximizeToggle),
    close: () => invoke(IPC_INVOKE.windowClose)
  },
  workspace: {
    listProjects: () => invoke(IPC_INVOKE.workspaceListProjects),
    pickDirectory: () => invoke(IPC_INVOKE.workspacePickDirectory),
    pickWorkspaceSources: () => invoke(IPC_INVOKE.workspacePickWorkspaceSources),
    pickWorkspaceFile: () => invoke(IPC_INVOKE.workspacePickWorkspaceFile),
    saveWorkspaceFile: () => invoke(IPC_INVOKE.workspaceSaveWorkspaceFile),
    allowRoot: (root) => invoke(IPC_INVOKE.workspaceAllowRoot, { root }),
    projectContextMenu: (projectKey, projectRoot, isPinned, locale) =>
      invoke(IPC_INVOKE.workspaceProjectContextMenu, {
        projectKey,
        projectRoot,
        isPinned,
        locale
      }),
    sessionFolderContextMenu: (locale) =>
      invoke(IPC_INVOKE.workspaceSessionFolderContextMenu, { locale }),
    getPathForFile: async (file) => {
      const root = webUtils.getPathForFile(file as never)
      if (root) await invoke(IPC_INVOKE.workspaceAuthorizeDroppedRoot, { root })
      return root
    },
    getActive: () => invoke(IPC_INVOKE.workspaceGetActive),
    sync: (input) => invoke(IPC_INVOKE.workspaceSync, input),
    openWorkspaceFile: (path) => invoke(IPC_INVOKE.workspaceOpenFile, { path }),
    save: (input) => invoke(IPC_INVOKE.workspaceSave, input),
    search: (query, scope, folderId) =>
      invoke(IPC_INVOKE.workspaceSearch, { query, scope, folderId }),
    openInTerminal: (directory) => invoke(IPC_INVOKE.workspaceOpenTerminal, { directory }),
    relocateFolder: (folderId, path) =>
      invoke(IPC_INVOKE.workspaceRelocateFolder, { folderId, path }),
    listRecent: () => invoke(IPC_INVOKE.workspaceListRecent),
    bindSession: (sessionId, workspaceId, folders, mainFolderId) =>
      invoke(IPC_INVOKE.workspaceBindSession, { sessionId, workspaceId, folders, mainFolderId }),
    getSessionBinding: (sessionId) => invoke(IPC_INVOKE.workspaceGetSessionBinding, { sessionId }),
    listSessionBindings: () => invoke(IPC_INVOKE.workspaceListSessionBindings)
  },
  sessions: {
    list: (force) => invoke(IPC_INVOKE.sessionList, force),
    get: (sessionId) => invoke(IPC_INVOKE.sessionGet, sessionId),
    rename: (sessionId, name) => invoke(IPC_INVOKE.sessionRename, { sessionId, name }),
    delete: (sessionId) => invoke(IPC_INVOKE.sessionDelete, sessionId),
    context: (sessionId, leafId) => invoke(IPC_INVOKE.sessionContext, { sessionId, leafId }),
    export: (sessionId, format) => invoke(IPC_INVOKE.sessionExport, { sessionId, format }),
    exportProject: (name, sessionIds, format) =>
      invoke(IPC_INVOKE.projectExport, { name, sessionIds, format }),
    viewFullHistory: (sessionId) => invoke(IPC_INVOKE.sessionViewHistory, sessionId),
    contextMenu: (sessionId, isWorktree, isPinned, locale) =>
      invoke(IPC_INVOKE.sessionContextMenu, { sessionId, isWorktree, isPinned, locale })
  },
  agent: {
    start: (input) => invoke(IPC_INVOKE.agentStart, input),
    prompt: (input) => invoke(IPC_INVOKE.agentPrompt, input),
    abort: (sessionId) => invoke(IPC_INVOKE.agentAbort, sessionId),
    state: (sessionId) => invoke(IPC_INVOKE.agentState, sessionId),
    running: () => invoke(IPC_INVOKE.agentRunning),
    command: (sessionId, command) => invoke(IPC_INVOKE.agentCommand, { sessionId, ...command })
  },
  harness: {
    state: (sessionId) => invoke(IPC_INVOKE.harnessGetState, { sessionId }),
    tools: (sessionId) => invoke(IPC_INVOKE.harnessGetTools, { sessionId }),
    setTools: (sessionId, toolNames) =>
      invoke(IPC_INVOKE.harnessSetTools, { sessionId, toolNames }),
    setModel: (sessionId, provider, modelId) =>
      invoke(IPC_INVOKE.harnessSetModel, { sessionId, provider, modelId }),
    setThinkingLevel: (sessionId, level) =>
      invoke(IPC_INVOKE.harnessSetThinkingLevel, { sessionId, level }),
    compact: (sessionId, instructions) =>
      invoke(IPC_INVOKE.harnessCompact, { sessionId, ...(instructions ? { instructions } : {}) }),
    abortCompaction: (sessionId) => invoke(IPC_INVOKE.harnessAbortCompaction, { sessionId }),
    setAutoCompaction: (sessionId, enabled) =>
      invoke(IPC_INVOKE.harnessSetAutoCompaction, { sessionId, enabled }),
    steer: (sessionId, message) => invoke(IPC_INVOKE.harnessSteer, { sessionId, message }),
    followUp: (sessionId, message) => invoke(IPC_INVOKE.harnessFollowUp, { sessionId, message }),
    fork: (sessionId, entryId) => invoke(IPC_INVOKE.harnessFork, { sessionId, entryId }),
    navigateTree: (sessionId, entryId) =>
      invoke(IPC_INVOKE.harnessNavigateTree, { sessionId, entryId }),
    session: (sessionId) => invoke(IPC_INVOKE.harnessGetSession, { sessionId }),
    stats: (sessionId) => invoke(IPC_INVOKE.harnessGetStats, { sessionId }),
    timeline: (sessionId) => invoke(IPC_INVOKE.harnessGetTimeline, { sessionId })
  },
  files: {
    list: (directory) => invoke(IPC_INVOKE.filesList, directory),
    read: (path) => invoke(IPC_INVOKE.filesRead, path),
    write: (path, text, expectedRevision, overwrite) =>
      invoke(IPC_INVOKE.filesWrite, { path, text, expectedRevision, overwrite }),
    upload: (directory, fileName, dataBase64, overwrite) =>
      invoke(IPC_INVOKE.filesUpload, { directory, fileName, dataBase64, overwrite })
  },
  git: {
    status: (cwd) => invoke(IPC_INVOKE.gitStatus, cwd),
    statusMany: (cwds) => invoke(IPC_INVOKE.gitStatusMany, { cwds }),
    diff: (cwd, filePath) => invoke(IPC_INVOKE.gitDiff, { cwd, filePath })
  },
  worktrees: {
    list: (cwd) => invoke(IPC_INVOKE.worktreeList, cwd),
    create: (cwd, branch) => invoke(IPC_INVOKE.worktreeCreate, { cwd, branch }),
    remove: (cwd, worktreePath, force) =>
      invoke(IPC_INVOKE.worktreeRemove, { cwd, worktreePath, force })
  },
  aiMotion: {
    setActive: (input) => invoke(IPC_INVOKE.aiMotionSetActive, input)
  },
  on(event, listener) {
    const ipcListener = listener as IpcEventListener
    if (event === 'config-changed') return onEvent(IPC_EVENT.configChanged, ipcListener)
    if (event === 'pi-environment-changed')
      return onEvent(IPC_EVENT.piEnvironmentChanged, ipcListener)
    if (event === 'environment-install-task')
      return onEvent(IPC_EVENT.environmentInstallTask, ipcListener)
    if (event === 'notification') return onEvent(IPC_EVENT.notification, ipcListener)
    if (event === 'agent-event') return onEvent(IPC_EVENT.agentEvent, ipcListener)
    if (event === 'agent-running') return onEvent(IPC_EVENT.agentRunning, ipcListener)
    if (event === 'harness-event') return onEvent(IPC_EVENT.harnessEvent, ipcListener)
    if (event === 'updater-state') return onEvent(IPC_EVENT.updaterState, ipcListener)
    if (event === 'capability-progress') return onEvent(IPC_EVENT.capabilityProgress, ipcListener)
    if (event === 'workspace-changed') return onEvent(IPC_EVENT.workspaceChanged, ipcListener)
    return () => {}
  }
}

contextBridge.exposeInMainWorld(API_NAMESPACE, api)

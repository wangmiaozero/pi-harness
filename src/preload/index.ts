/**
 * Preload bridge — exposes typed `window.piSwitch` via contextBridge.
 * Renderer never sees ipcRenderer or channel strings.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC_EVENT, IPC_INVOKE } from '../shared/ipc/channels'
import type { PiSwitchAPI, IpcEventListener } from '../shared/ipc/api-types'
import type { AppErrorPayload } from '../shared/types/errors'
import { API_NAMESPACE } from '../shared/constants/index'

type IpcResult<T> = { ok: true; data: T } | { ok: false; error: AppErrorPayload }

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, ...args)) as IpcResult<T>
  if (!result || typeof result !== 'object' || !('ok' in result)) {
    throw Object.assign(new Error('Malformed IPC response'), {
      payload: { code: 'IPC_ERROR', message: 'Malformed IPC response' } satisfies AppErrorPayload
    })
  }
  if (!result.ok) {
    throw Object.assign(new Error(result.error.message), { payload: result.error })
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
    update: (force) => invoke(IPC_INVOKE.piUpdate, force)
  },
  providers: {
    list: () => invoke(IPC_INVOKE.providerList),
    get: (key) => invoke(IPC_INVOKE.providerGet, key),
    create: (form, options) => invoke(IPC_INVOKE.providerCreate, form, options ?? {}),
    update: (key, form, options) => invoke(IPC_INVOKE.providerUpdate, key, form, options ?? {}),
    delete: (key, options) => invoke(IPC_INVOKE.providerDelete, key, options ?? {}),
    duplicate: (key, options) => invoke(IPC_INVOKE.providerDuplicate, key, options ?? {}),
    setEnabled: (key, enabled) => invoke(IPC_INVOKE.providerSetEnabled, key, enabled),
    testConnection: (input) => invoke(IPC_INVOKE.providerTestConnection, input)
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
    list: () => invoke(IPC_INVOKE.skillsList),
    packages: () => invoke(IPC_INVOKE.skillsPackages),
    market: () => invoke(IPC_INVOKE.skillsMarket),
    installPackages: (sources) => invoke(IPC_INVOKE.skillsInstallPackages, sources),
    removePackage: (source) => invoke(IPC_INVOKE.skillsRemovePackage, source),
    read: (path) => invoke(IPC_INVOKE.skillRead, path),
    create: (form) => invoke(IPC_INVOKE.skillCreate, form),
    update: (form) => invoke(IPC_INVOKE.skillUpdate, form),
    import: (input) => invoke(IPC_INVOKE.skillImport, input),
    validate: (form) => invoke(IPC_INVOKE.skillValidate, form),
    delete: (path) => invoke(IPC_INVOKE.skillDelete, path),
    refresh: () => invoke(IPC_INVOKE.skillsRefresh)
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
    check: () => invoke(IPC_INVOKE.updaterCheck),
    download: () => invoke(IPC_INVOKE.updaterDownload),
    install: () => invoke(IPC_INVOKE.updaterInstall)
  },
  window: {
    minimize: () => invoke(IPC_INVOKE.windowMinimize),
    maximizeToggle: () => invoke(IPC_INVOKE.windowMaximizeToggle),
    close: () => invoke(IPC_INVOKE.windowClose)
  },
  on(event, listener) {
    if (event === 'config-changed') return onEvent(IPC_EVENT.configChanged, listener)
    if (event === 'pi-environment-changed') return onEvent(IPC_EVENT.piEnvironmentChanged, listener)
    if (event === 'notification') return onEvent(IPC_EVENT.notification, listener)
    return () => {}
  }
}

contextBridge.exposeInMainWorld(API_NAMESPACE, api)

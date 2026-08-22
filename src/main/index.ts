/**
 * Electron main process entry.
 */

import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { initAppPaths, appSettingsPath, appUiStatePath } from './services/app-paths'
import { JsonStore } from './services/storage'
import { log } from './services/logger'
import { BackupService } from './backup/backup-service'
import { PiConfigService } from './pi/config-service'
import { createMetadataStore } from './services/metadata-store'
import { ProviderService } from './services/provider-service'
import { ModelService } from './services/model-service'
import { SkillsService } from './services/skills-service'
import { DiagnosticsService } from './services/diagnostics-service'
import { registerIpc, broadcastConfigChanged } from './ipc/register'
import { createMainWindow } from './window/create-window'
import type { AppSettings } from '@shared/ipc/api-types'
import { APP_NAME } from '@shared/constants/index'
import { FileAccessService } from './files/file-access-service'
import { FileService } from './files/file-service'
import { GitService } from './git/git-service'
import { WorktreeService } from './git/worktree-service'
import { SessionService } from './sessions/session-service'
import { SessionExportService } from './sessions/session-export-service'
import { AgentRuntimeService } from './agent/agent-runtime-service'

const DEFAULT_SETTINGS: AppSettings = {
  language: 'zh-CN',
  theme: 'dark',
  density: 'comfortable',
  mockMode: false,
  manualCliPath: null,
  manualConfigDir: null,
  autoBackup: true,
  backupRetention: 20,
  developerMode: false,
  defaultToolPreset: 'default',
  restoreTabs: true,
  autoOpenLastProject: true
}

app.setName(APP_NAME)

// Allow e2e / isolated runs to redirect userData before ready.
const userDataOverride =
  process.env.PI_HARNESS_USER_DATA?.trim() || process.env.PI_SWITCH_USER_DATA?.trim()
if (userDataOverride) {
  app.setPath('userData', path.resolve(userDataOverride))
}

// Single instance
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  void bootstrap()
}

async function bootstrap(): Promise<void> {
  await app.whenReady()
  initAppPaths(app)

  // Harden: deny permission requests by default
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (e) => e.preventDefault())
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.session.setPermissionCheckHandler(() => false)
    contents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false)
    })
  })

  const settingsStore = new JsonStore<AppSettings>(appSettingsPath(), DEFAULT_SETTINGS)
  await settingsStore.read()
  const uiStateStore = new JsonStore<Record<string, unknown>>(appUiStatePath(), {})
  await uiStateStore.read()

  const metadata = createMetadataStore()
  await metadata.read()

  const backup = new BackupService(settingsStore)
  const config = new PiConfigService(settingsStore, backup)
  backup.attachConfig(config)
  // Establish the conflict baseline eagerly so the first write after launch
  // can detect an external change (config.read also caches the raw content
  // used by the Configuration Conflict "Compare" view). Safe when Pi is not
  // installed — missing files yield null mtimes (no false conflicts).
  await config.read().catch((err) => log.config.warn('initial config read failed:', err))
  const providers = new ProviderService(config, metadata)
  const models = new ModelService(config, metadata)
  const skills = new SkillsService(settingsStore)
  const diagnostics = new DiagnosticsService(settingsStore, config)

  const access = new FileAccessService()
  const worktrees = new WorktreeService(access)
  const sessions = new SessionService(settingsStore, worktrees, access)
  access.attachSessionLister(() => sessions.list())
  const files = new FileService(access)
  const git = new GitService(access)
  const sessionExport = new SessionExportService(sessions)
  const agent = new AgentRuntimeService(sessions)
  diagnostics.attachWorkspace({
    sessions,
    agent,
    access
  })

  let mainWindow: BrowserWindow | null = null
  agent.attachWindow(() => mainWindow)

  registerIpc({
    settingsStore,
    uiStateStore,
    config,
    providers,
    models,
    backup,
    skills,
    diagnostics,
    workspace: { access, files, git, worktrees, sessions, sessionExport, agent },
    getMainWindow: () => mainWindow
  })

  mainWindow = createMainWindow()

  config.startWatcher(() => {
    broadcastConfigChanged(mainWindow)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow()
    }
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    config.stopWatcher()
    void agent.shutdownAll()
  })

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  log.app.info(`${APP_NAME} ready`)
}

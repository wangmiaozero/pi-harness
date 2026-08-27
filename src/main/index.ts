/**
 * Electron main process entry.
 */

import { app, BrowserWindow, nativeTheme } from 'electron'
import path from 'node:path'
import {
  initAppPaths,
  appSettingsPath,
  appUiStatePath,
  appAuthorizedRootsPath
} from './services/app-paths'
import { JsonStore } from './services/storage'
import { log } from './services/logger'
import { BackupService } from './backup/backup-service'
import { PiConfigService } from './pi/config-service'
import { createMetadataStore } from './services/metadata-store'
import { ProviderService } from './services/provider-service'
import { ModelService } from './services/model-service'
import { SkillsService } from './services/skills-service'
import { DiagnosticsService } from './services/diagnostics-service'
import { registerIpc, broadcastConfigChanged, broadcastNotification } from './ipc/register'
import { createMainWindow } from './window/create-window'
import { ScreenMotionOverlayController } from './window/screen-motion-overlay'
import type { AppSettings } from '@shared/ipc/api-types'
import { APP_NAME } from '@shared/constants/index'
import { DEFAULT_MASCOT_STYLE } from '@shared/constants/mascot'
import { DEFAULT_NAV_ORDER } from '@shared/constants/navigation'
import { FileAccessService, type AuthorizedRootsState } from './files/file-access-service'
import { FileService } from './files/file-service'
import { GitService } from './git/git-service'
import { WorktreeService } from './git/worktree-service'
import { SessionService } from './sessions/session-service'
import { SessionExportService } from './sessions/session-export-service'
import { AgentRuntimeService } from './agent/agent-runtime-service'
import { onUpdateState, startAutomaticUpdates, stopAutomaticUpdates } from './updater'
import { IPC_EVENT } from '@shared/ipc/channels'
import { SkillRegistry } from './capabilities/skill-registry'
import { CapabilityService } from './capabilities/capability-service'
import { PiPackageManager } from './packages/package-manager'
import { BuiltinSkillService } from './skills/builtin-skill-service'
import { PackageHealthError } from './services/errors'
import { EnvironmentManager } from './environment/environment-manager'

const DEFAULT_SETTINGS: AppSettings = {
  language: 'zh-CN',
  theme: 'dark',
  mascotUnlocked: false,
  mascotStyle: DEFAULT_MASCOT_STYLE,
  petEnabled: false,
  petAnimations: true,
  petStatusText: true,
  petAutoSleep: true,
  petSleepMinutes: 10,
  petSound: false,
  mockMode: false,
  manualCliPath: null,
  manualConfigDir: null,
  autoBackup: true,
  backupRetention: 20,
  developerMode: false,
  defaultToolPreset: 'default',
  restoreTabs: true,
  autoOpenLastProject: true,
  windowMotionEnabled: false,
  screenMotionEnabled: true,
  navOrder: [...DEFAULT_NAV_ORDER]
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
  nativeTheme.themeSource = settingsStore.peek().theme
  const uiStateStore = new JsonStore<Record<string, unknown>>(appUiStatePath(), {})
  await uiStateStore.read()
  const authorizedRootsStore = new JsonStore<AuthorizedRootsState>(appAuthorizedRootsPath(), {
    roots: []
  })
  await authorizedRootsStore.read()

  const metadata = createMetadataStore()
  await metadata.read()

  let mainWindow: BrowserWindow | null = null
  const screenMotion = new ScreenMotionOverlayController()

  const openMainWindow = (): void => {
    mainWindow = createMainWindow()
    mainWindow.on('closed', () => {
      screenMotion.stop()
      mainWindow = null
    })
    screenMotion.start()
  }

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
  const access = new FileAccessService(authorizedRootsStore)
  const packageManager = new PiPackageManager(settingsStore, config, access)
  const builtinSkills = new BuiltinSkillService(settingsStore, metadata, access)
  const skills = new SkillsService(settingsStore, packageManager, builtinSkills, access)
  const skillRegistry = new SkillRegistry(settingsStore, metadata, skills)
  const capabilities = new CapabilityService(metadata, skillRegistry)
  const diagnostics = new DiagnosticsService(
    settingsStore,
    config,
    packageManager,
    capabilities,
    skills
  )
  const environment = new EnvironmentManager(settingsStore, {
    onTask: (task) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_EVENT.environmentInstallTask, task)
      }
    },
    onEnvironmentChanged: (state) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_EVENT.piEnvironmentChanged, state)
        mainWindow.webContents.send(IPC_EVENT.configChanged, { at: Date.now() })
      }
    }
  })

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

  agent.attachWindow(() => mainWindow)

  registerIpc({
    settingsStore,
    uiStateStore,
    config,
    providers,
    models,
    backup,
    skills,
    capabilities,
    diagnostics,
    environment,
    workspace: {
      access,
      files,
      git,
      worktrees,
      sessions,
      sessionExport,
      agent,
      beforeAgentStart: async (cwd, sessionId) => {
        const sessionInfo = !cwd && sessionId ? (await sessions.get(sessionId)).info : null
        const projectRoot = cwd ?? sessionInfo?.projectRoot ?? sessionInfo?.cwd ?? null
        const risky = (await packageManager.list(projectRoot)).filter(
          (pkg) =>
            pkg.registered && ['missing', 'permission-error', 'corrupted'].includes(pkg.health)
        )
        if (risky.length) {
          throw new PackageHealthError(
            `Pi package startup preflight failed: ${risky.map((pkg) => `${pkg.name} (${pkg.health})`).join(', ')}. Repair or fully uninstall them in Skills > Packages before starting Pi.`,
            {
              packages: risky.map((pkg) => ({
                id: pkg.id,
                name: pkg.name,
                health: pkg.health,
                scope: pkg.scope
              }))
            }
          )
        }
      }
    },
    getMainWindow: () => mainWindow,
    setScreenMotionActive: (payload) => screenMotion.setActive(payload)
  })

  openMainWindow()

  void packageManager
    .list()
    .then((packages) => {
      const risky = packages.filter(
        (pkg) => pkg.registered && ['missing', 'permission-error', 'corrupted'].includes(pkg.health)
      )
      if (!risky.length) return
      const chinese = settingsStore.peek().language === 'zh-CN'
      broadcastNotification(mainWindow, {
        level: 'warning',
        title: chinese ? '检测到扩展包启动风险' : 'Package startup risk detected',
        message: chinese
          ? `${risky.map((pkg) => pkg.name).join('、')} 需要先修复或彻底卸载。`
          : `${risky.map((pkg) => pkg.name).join(', ')} must be repaired or fully uninstalled.`
      })
    })
    .catch((error) => log.skills.warn('startup package health check failed', error))

  const unsubscribeUpdateState = onUpdateState((state) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_EVENT.updaterState, state)
    }
  })
  startAutomaticUpdates()

  config.startWatcher(() => {
    broadcastConfigChanged(mainWindow)
  })

  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      openMainWindow()
    }
  })

  app.on('window-all-closed', () => {
    screenMotion.stop()
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    screenMotion.stop()
    stopAutomaticUpdates()
    unsubscribeUpdateState()
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

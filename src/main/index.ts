/**
 * Electron main process entry.
 */

import { app, BrowserWindow, nativeTheme, protocol, net } from 'electron'
import path from 'node:path'
import {
  initAppPaths,
  getPiConfigDir,
  appSettingsPath,
  appUiStatePath,
  appAuthorizedRootsPath,
  appWorkspaceStatePath,
  appDefaultWorkspacePath,
  appDefaultWorkspaceAliases,
  userData,
  harnessCheckpointsPath,
  harnessPolicyPath,
  customSkinsDir
} from './services/app-paths'
import { JsonStore } from './services/storage'
import { UniversalSessionService } from './universal/service'
import { UniversalHandoffService } from './universal/handoff'
import { UniversalAiSummaryService } from './universal/ai-summary'
import { defaultSources } from './universal/sources'
import { ProjectIntelligenceService } from './intelligence/service'
import { ArchitectureSnapshots } from './intelligence/snapshots'
import { ArchifyProvider } from './intelligence/archify'
import { ArchitectureModel } from './intelligence/model'
import { architectureTools } from './intelligence/tools'
import { ArchitectureViewer } from './intelligence/viewer'
import { canUseArchitectureFullscreen } from './intelligence/fullscreen-permission'
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
import { installAppMenu } from './window/app-menu'
import { ScreenMotionOverlayController } from './window/screen-motion-overlay'
import type { AppSettings } from '@shared/ipc/api-types'
import { APP_NAME } from '@shared/constants/index'
import { isChineseLocale, resolveAppLocale } from '@shared/constants/language'
import { DEFAULT_MASCOT_STYLE } from '@shared/constants/mascot'
import { DEFAULT_NAV_ORDER } from '@shared/constants/navigation'
import { normalizeAppTheme, themeAppearance } from '@shared/constants/theme'
import { DEFAULT_MACOS27_BACKGROUND } from '@shared/constants/macos27-background'
import { FileAccessService, type AuthorizedRootsState } from './files/file-access-service'
import { FileService } from './files/file-service'
import { GitService } from './git/git-service'
import { GitCommitMessageService } from './git/commit-message-service'
import { WorktreeService } from './git/worktree-service'
import { SessionService } from './sessions/session-service'
import { SessionExportService } from './sessions/session-export-service'
import { RuntimeManager } from './runtime/runtime-manager'
import { setRuntimeProvider } from './runtime/active'
import { PiRpcRuntime } from './agent/pi-rpc-runtime'
import { AgentRuntimeService } from './agent/agent-runtime-service'
import { resolveWorkspaceToolPath } from './workspace/workspace-tool-guard'
import { WorkspaceService, type WorkspaceStateRecord } from './workspace/workspace-service'
import { PiHarnessAdapter } from './harness/adapters/pi-harness-adapter'
import { HarnessRuntime } from './harness/harness-runtime'
import { createOrchestrator } from './harness/orchestrator/orchestrator-host'
import { PolicyEngine } from './harness/policy/policy-engine'
import { DEFAULT_POLICY_CONFIG } from './harness/policy/policy-defaults'
import { projectIdentityKey } from '@shared/workspace/project-identity'
import { assertPolicyToolAllowed } from './harness/policy/policy-tool-guard'
import { EMPTY_CHECKPOINT_STORE } from './harness/checkpoint/checkpoint-service'
import { onUpdateState, startAutomaticUpdates, stopAutomaticUpdates } from './updater'
import { IPC_EVENT } from '@shared/ipc/channels'
import { SkillRegistry } from './capabilities/skill-registry'
import { CapabilityService } from './capabilities/capability-service'
import { PiPackageManager } from './packages/package-manager'
import { PiPackageRegistry } from './packages/pi-package-registry'
import { BuiltinSkillService } from './skills/builtin-skill-service'
import { PackageHealthError, PathDeniedError } from './services/errors'
import { EnvironmentManager } from './environment/environment-manager'
import { applyChromiumGpuWorkarounds } from './window/chromium-flags'
import { applyAppIcon, selectedAppIconPath } from './window/app-icon'
import { normalizeAppIconPreference } from '@shared/constants/app-icon'
import { runWindowsStartupPreflight } from './services/windows-startup-preflight'
import { CustomSkinService } from './skins/custom-skin-service'
import { DEFAULT_ASSISTANT_NAME, DEFAULT_USER_NAME } from '@shared/constants/chat-participants'

const DEFAULT_SETTINGS: AppSettings = {
  language: 'auto',
  theme: 'dark',
  macos27Background: DEFAULT_MACOS27_BACKGROUND,
  macos27BackgroundImage: null,
  userName: DEFAULT_USER_NAME,
  assistantName: DEFAULT_ASSISTANT_NAME,
  appIcon: 'auto',
  mascotUnlocked: false,
  mascotStyle: DEFAULT_MASCOT_STYLE,
  customSkinId: null,
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
  screenMotionEnabled: false,
  composerFireEnabled: true,
  navOrder: [...DEFAULT_NAV_ORDER]
}

app.setName(APP_NAME)
applyChromiumGpuWorkarounds()

process.on('uncaughtException', (error) => {
  log.app.error('uncaughtException', error)
})
process.on('unhandledRejection', (reason) => {
  log.app.error('unhandledRejection', reason)
})

// Keep development isolated from an installed Pi-Harness instance. Electron's
// single-instance lock is scoped by userData, so sharing the production path
// makes `pnpm dev` exit cleanly as soon as the installed app is open.
const userDataOverride =
  process.env.PI_HARNESS_USER_DATA?.trim() ||
  process.env.PI_SWITCH_USER_DATA?.trim() ||
  (!app.isPackaged ? path.join(app.getPath('appData'), `${APP_NAME}-dev`) : null)
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
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'pi-architecture',
      privileges: { standard: true, secure: true, supportFetchAPI: true }
    }
  ])
  initAppPaths(app)

  if (process.platform === 'win32') {
    try {
      const result = await runWindowsStartupPreflight(
        userData(),
        app.getVersion(),
        DEFAULT_SETTINGS
      )
      let processFailed = false
      app.on('render-process-gone', (_event, _contents, details) => {
        if (details.reason !== 'clean-exit' && details.reason !== 'killed') processFailed = true
      })
      app.on('child-process-gone', (_event, details) => {
        if (details.type === 'GPU' && details.reason !== 'clean-exit') processFailed = true
      })
      app.on('will-quit', () => {
        if (!processFailed) result.markClean()
      })
      if (result.repaired.length)
        log.app.info('Windows startup preflight repaired', result.repaired)
    } catch (error) {
      log.app.error('Windows startup preflight failed', error)
    }
  }

  await app.whenReady()

  // Harden: deny permission requests by default
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (e) => e.preventDefault())
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.session.setPermissionCheckHandler((requester, permission, _origin, details) =>
      canUseArchitectureFullscreen(requester, permission, details)
    )
    contents.session.setPermissionRequestHandler((requester, permission, callback, details) => {
      callback(canUseArchitectureFullscreen(requester, permission, details))
    })
  })

  const settingsStore = new JsonStore<AppSettings>(appSettingsPath(), DEFAULT_SETTINGS)
  const storedSettings = await settingsStore.read()
  const theme = normalizeAppTheme(storedSettings.theme)
  if (theme !== storedSettings.theme) await settingsStore.update({ theme })
  const appIcon = normalizeAppIconPreference(storedSettings.appIcon)
  if (appIcon !== storedSettings.appIcon) await settingsStore.update({ appIcon })
  nativeTheme.themeSource = themeAppearance(theme)
  applyAppIcon(settingsStore.peek(), null)
  // Install before the first window opens: replaces Electron's default menu,
  // whose CmdOrCtrl+W "Close Window" accelerator hijacked the workspace
  // close-tab shortcut and closed the whole window mid-conversation.
  installAppMenu(storedSettings.language)
  const uiStateStore = new JsonStore<Record<string, unknown>>(appUiStatePath(), {})
  await uiStateStore.read()
  const authorizedRootsStore = new JsonStore<AuthorizedRootsState>(appAuthorizedRootsPath(), {
    roots: []
  })
  await authorizedRootsStore.read()
  const workspaceStateStore = new JsonStore<WorkspaceStateRecord>(appWorkspaceStatePath(), {
    active: null,
    recent: [],
    sessionBindings: {}
  })
  await workspaceStateStore.read()

  const metadata = createMetadataStore()
  await metadata.read()

  let mainWindow: BrowserWindow | null = null
  const screenMotion = new ScreenMotionOverlayController()

  const openMainWindow = (): void => {
    const settings = settingsStore.peek()
    mainWindow = createMainWindow(selectedAppIconPath(settings))
    applyAppIcon(settings, mainWindow)
    mainWindow.on('closed', () => {
      screenMotion.stop()
      mainWindow = null
    })
    screenMotion.start()
  }

  const backup = new BackupService(settingsStore)
  const customSkins = new CustomSkinService(customSkinsDir())
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
  const packageRegistry = new PiPackageRegistry(
    process.env.PI_HARNESS_E2E === '1'
      ? {
          searchUrl: process.env.PI_HARNESS_REGISTRY_SEARCH_URL,
          registryUrl: process.env.PI_HARNESS_REGISTRY_URL,
          downloadsUrl: process.env.PI_HARNESS_DOWNLOADS_URL
        }
      : undefined
  )
  const builtinSkills = new BuiltinSkillService(settingsStore, metadata, access)
  const skills = new SkillsService(
    settingsStore,
    packageManager,
    builtinSkills,
    access,
    packageRegistry
  )
  const skillRegistry = new SkillRegistry(settingsStore, metadata, skills)
  const capabilities = new CapabilityService(metadata, skillRegistry, undefined, packageManager)
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
  const gitCommitMessages = new GitCommitMessageService(config)
  const workspaceState = new WorkspaceService(
    access,
    workspaceStateStore,
    appDefaultWorkspacePath(),
    appDefaultWorkspaceAliases()
  )
  await workspaceState.load().catch((error) => log.app.warn('workspace load failed:', error))
  workspaceState.onFilesChanged((roots) => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
    mainWindow.webContents.send(IPC_EVENT.workspaceChanged, { roots })
  })
  const sessionExport = new SessionExportService(sessions)
  const policyEngine = new PolicyEngine(
    new JsonStore(harnessPolicyPath(), structuredClone(DEFAULT_POLICY_CONFIG))
  )
  const harnessRef: { current: HarnessRuntime | null } = { current: null }
  const intelligenceModel = new ArchitectureModel(config, policyEngine)
  const intelligence = new ProjectIntelligenceService(
    access,
    new ArchitectureSnapshots(path.join(userData(), 'project-intelligence')),
    new ArchifyProvider(
      app.isPackaged
        ? path.join(process.resourcesPath, 'archify')
        : path.resolve(import.meta.dirname, '../../resources/archify'),
      path.join(userData(), 'project-intelligence-render')
    ),
    (root, graph, scan, signal, locale) =>
      intelligenceModel.enrich(root, graph, scan, signal, locale)
  )

  const desktopHooks: NonNullable<ConstructorParameters<typeof AgentRuntimeService>[1]> = {
    prepareSession: async (sessionId, cwd) => {
      if (workspaceState.getFoldersForSession(sessionId).length) return
      const active = workspaceState.getActive()
      if (
        active?.folders.some(
          (folder) => projectIdentityKey(folder.resolvedPath) === projectIdentityKey(cwd)
        )
      ) {
        await workspaceState.bindActiveToSession(sessionId)
      } else {
        const id = projectIdentityKey(cwd)
        await workspaceState.bindSession(sessionId, {
          workspaceId: `session:${sessionId}`,
          mainFolderId: id,
          folders: [{ id, path: cwd, role: 'main' }]
        })
      }
    },
    architectureHint: (cwd) => intelligence.hint(cwd),
    customTools: async (_cwd, sessionId) =>
      architectureTools(
        intelligence,
        () => workspaceState.getFoldersForSession(sessionId)[0]?.resolvedPath ?? null
      ),
    getPrompt: (sessionId) => workspaceState.getPromptForSession(sessionId),
    assertWritable: (target, sessionId) => {
      const folders = workspaceState.getFoldersForSession(sessionId)
      if (!folders.length) {
        throw new PathDeniedError('No projects are attached to this session.', { sessionId })
      }
      const primary = folders.find((folder) => folder.role === 'main') ?? folders[0]
      return access.assertWritableInFolders(
        resolveWorkspaceToolPath(target, primary.resolvedPath),
        folders
      )
    },
    assertToolAllowed: (toolName, input, sessionId, signal) => {
      return assertPolicyToolAllowed(
        policyEngine,
        {
          sessionId,
          signal,
          report: (payload) =>
            harnessRef.current?.recordPolicyDecision(sessionId, { sessionId, ...payload })
        },
        toolName,
        input
      )
    }
  }
  const piAgent = new AgentRuntimeService(sessions, desktopHooks)
  let rpcAgent: PiRpcRuntime | null = null
  const runtimes = new RuntimeManager({
    bundledRoot: app.isPackaged
      ? path.join(process.resourcesPath, 'runtimes')
      : path.resolve(
          import.meta.dirname,
          '../../resources/runtimes',
          `${process.platform}-${process.arch}`
        ),
    userRoot: path.join(userData(), 'runtimes'),
    stateFile: path.join(userData(), 'runtime-configuration.json'),
    cache: path.join(userData(), 'runtime-downloads'),
    fetcher: net.fetch,
    compatibilityMode: process.env.PI_HARNESS_AGENT_MODE === 'sdk',
    piConfigDir: () => getPiConfigDir(settingsStore.peek().manualConfigDir),
    legacyPiPath:
      process.env.PI_HARNESS_AGENT_MODE === 'sdk'
        ? (process.env.PI_HARNESS_PI_CLI_PATH ?? settingsStore.peek().manualCliPath)
        : settingsStore.peek().manualCliPath,
    busy: () => Boolean(rpcAgent?.isBusy() || piAgent.listRunning().length),
    activeSessions: () => (rpcAgent?.listRunning().length ?? 0) + piAgent.listRunning().length,
    stopIdle: async () => {
      await rpcAgent?.stopIdle()
    }
  })
  await runtimes.initialize()
  setRuntimeProvider(runtimes)
  rpcAgent = new PiRpcRuntime(sessions, runtimes, {
    extensionPath: app.isPackaged
      ? path.join(process.resourcesPath, 'desktop-extension/index.mjs')
      : path.resolve(import.meta.dirname, '../../resources/desktop-extension/index.mjs'),
    configDir: () => getPiConfigDir(settingsStore.peek().manualConfigDir),
    workspace: desktopHooks
  })
  const harness = new HarnessRuntime(
    process.env.PI_HARNESS_AGENT_MODE === 'sdk' ? new PiHarnessAdapter(piAgent) : rpcAgent,
    {
      policy: policyEngine,
      checkpointStore: new JsonStore(harnessCheckpointsPath(), EMPTY_CHECKPOINT_STORE),
      sessions,
      git
    }
  )
  harnessRef.current = harness
  const orchestrator = createOrchestrator(harness, workspaceState, worktrees)

  diagnostics.attachWorkspace({
    sessions,
    agent: harness,
    access
  })

  piAgent.attachWindow(() => mainWindow)
  rpcAgent.attachWindow(() => mainWindow)
  harness.attachWindow(() => mainWindow)

  // Multi-Agent Orchestration — one subscription onto the unified stream.
  orchestrator.attach()
  await orchestrator
    .recoverAll()
    .then((count) => {
      if (count) log.harness.info(`recovered ${count} interrupted orchestration(s) after restart`)
    })
    .catch((error) => log.harness.warn('orchestration recovery failed:', error))
  await orchestrator
    .ensureBuiltinPresets()
    .catch((error) => log.harness.warn('orchestration presets failed:', error))

  const beforeAgentStart = async (
    cwd: string | null | undefined,
    sessionId: string | null | undefined
  ) => {
    const sessionInfo = !cwd && sessionId ? (await sessions.get(sessionId)).info : null
    const projectRoot = cwd ?? sessionInfo?.projectRoot ?? sessionInfo?.cwd ?? null
    if (sessionId) await workspaceState.activateSession(sessionId, projectRoot)
    const risky = (await packageManager.list(projectRoot)).filter(
      (pkg) => pkg.registered && ['missing', 'permission-error', 'corrupted'].includes(pkg.health)
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
  const universalHome = process.env.PI_HARNESS_SESSION_HOME
  const universal = new UniversalSessionService(path.join(userData(), 'universal-sessions'), [
    ...defaultSources(
      universalHome,
      process.platform,
      universalHome ? { PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR } : process.env
    ),
    { provider: 'pi', root: sessions.sessionsRoot(), custom: false }
  ])
  const universalHandoff = new UniversalHandoffService({
    history: universal,
    access,
    workspace: workspaceState,
    agent: harness,
    config,
    organizeHistory: (handoff) => new UniversalAiSummaryService(config).organize(handoff),
    beforeStart: (cwd) => beforeAgentStart(cwd, null)
  })

  registerIpc({
    runtimes,
    intelligence,
    architectureViewer: new ArchitectureViewer(
      intelligence,
      app.isPackaged
        ? path.join(process.resourcesPath, 'archify')
        : path.resolve(import.meta.dirname, '../../resources/archify'),
      () => mainWindow
    ),
    universal,
    universalHandoff,
    settingsStore,
    uiStateStore,
    config,
    providers,
    models,
    backup,
    skills,
    capabilities,
    diagnostics,
    customSkins,
    environment,
    harness,
    orchestrator,
    workspace: {
      access,
      files,
      git,
      gitCommitMessages,
      worktrees,
      sessions,
      sessionExport,
      agent: harness,
      workspaceState,
      beforeAgentStart
    },
    getMainWindow: () => mainWindow,
    setAppIcon: (settings) => applyAppIcon(settings, mainWindow),
    setScreenMotionActive: (payload) => {
      const restoreMainWindow = payload.active && mainWindow?.isFocused() === true
      screenMotion.setActive(payload)
      if (!restoreMainWindow) return
      setImmediate(() => {
        if (!mainWindow || mainWindow.isDestroyed()) return
        if (!mainWindow.isVisible()) mainWindow.show()
        mainWindow.focus()
      })
    }
  })

  openMainWindow()

  void packageManager
    .list()
    .then((packages) => {
      const risky = packages.filter(
        (pkg) => pkg.registered && ['missing', 'permission-error', 'corrupted'].includes(pkg.health)
      )
      if (!risky.length) return
      const chinese = isChineseLocale(
        resolveAppLocale(settingsStore.peek().language, app.getLocale())
      )
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
    void intelligence.cancelAll()
    screenMotion.stop()
    if (process.platform !== 'darwin') app.quit()
  })

  let quitCleanup: Promise<void> | null = null
  let quitCleanupComplete = false
  app.on('before-quit', (event) => {
    if (quitCleanupComplete) return
    event.preventDefault()
    if (quitCleanup) return
    screenMotion.stop()
    stopAutomaticUpdates()
    unsubscribeUpdateState()
    config.stopWatcher()
    orchestrator.detach()
    quitCleanup = (async () => {
      // Native shutdown hooks must finish before Electron exits or stores close.
      try {
        await harness.shutdownAll()
      } finally {
        const results = await Promise.allSettled([
          sessions.close(),
          intelligence.close(),
          universal.close(),
          workspaceState.close()
        ])
        for (const result of results) {
          if (result.status === 'rejected') log.app.error('shutdown cleanup failed:', result.reason)
        }
      }
    })()
    void quitCleanup
      .catch((error) => log.app.error('runtime shutdown failed:', error))
      .finally(() => {
        quitCleanupComplete = true
        app.quit()
      })
  })

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  log.app.info(`${APP_NAME} ready`)
}

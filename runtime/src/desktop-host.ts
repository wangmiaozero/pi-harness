/**
 * Phase 5 desktop services: Providers / Models / Config / Skills / Packages /
 * Capabilities / Settings / Backup / Diagnostics / Environment.
 *
 * Ported from the Electron main-process composition in `src/main/index.ts`.
 * The sidecar owns Pi-ecosystem logic; the Tauri host owns dialogs, clipboard,
 * PATH (Finder launch), and opening folders/URLs.
 */

import type { AppSettings } from './vendor/shared/ipc/api-types.js'
import { DEFAULT_MASCOT_STYLE } from './vendor/shared/constants/mascot.js'
import { DEFAULT_NAV_ORDER } from './vendor/shared/constants/navigation.js'
import { JsonStore } from './desktop/services/storage.js'
import { createMetadataStore } from './desktop/services/metadata-store.js'
import { BackupService } from './desktop/backup/backup-service.js'
import { PiConfigService } from './desktop/pi/config-service.js'
import { ProviderService } from './desktop/services/provider-service.js'
import { ModelService } from './desktop/services/model-service.js'
import { SkillsService } from './desktop/services/skills-service.js'
import { DiagnosticsService } from './desktop/services/diagnostics-service.js'
import { PiPackageManager } from './desktop/packages/package-manager.js'
import { PiPackageRegistry } from './desktop/packages/pi-package-registry.js'
import { BuiltinSkillService } from './desktop/skills/builtin-skill-service.js'
import { SkillRegistry } from './desktop/capabilities/skill-registry.js'
import { CapabilityService } from './desktop/capabilities/capability-service.js'
import { EnvironmentManager } from './desktop/environment/environment-manager.js'
import { FileAccessService, type AuthorizedRootsState } from './desktop/files/file-access-service.js'
import {
  appSettingsPath,
  appUiStatePath,
  appAuthorizedRootsPath,
  logFilePath
} from './desktop/services/app-paths.js'
import { piProcess } from './desktop/process/pi-process.js'
import type { SessionService } from './session/service.js'
import type { AgentRuntimeManager } from './agent/manager.js'
import { peekPiSdk } from './pi/sdk.js'

export const DEFAULT_APP_SETTINGS: AppSettings = {
  language: 'auto',
  theme: 'dark',
  mascotUnlocked: false,
  mascotStyle: DEFAULT_MASCOT_STYLE,
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
  navOrder: [...DEFAULT_NAV_ORDER]
}

export interface DesktopEventSinks {
  onConfigChanged?: (payload: { at: number }) => void
  onEnvironmentChanged?: (environment: unknown) => void
  onInstallTask?: (task: unknown) => void
  onCapabilityProgress?: (progress: unknown) => void
}

export interface DesktopServices {
  settingsStore: JsonStore<AppSettings>
  uiStateStore: JsonStore<Record<string, unknown>>
  backup: BackupService
  config: PiConfigService
  providers: ProviderService
  models: ModelService
  skills: SkillsService
  capabilities: CapabilityService
  diagnostics: DiagnosticsService
  environment: EnvironmentManager
  access: FileAccessService
  packageManager: PiPackageManager
  piProcess: typeof piProcess
  /** Serialise environment vs package mutations (never concurrent). */
  runMutation<T>(kind: 'env' | 'package', fn: () => Promise<T>): Promise<T>
  shutdown(): Promise<void>
}

export function createDesktopServices(
  deps: {
    sessions?: SessionService
    agent?: AgentRuntimeManager
    events?: DesktopEventSinks
  } = {}
): DesktopServices {
  const settingsStore = new JsonStore<AppSettings>(appSettingsPath(), DEFAULT_APP_SETTINGS)
  const uiStateStore = new JsonStore<Record<string, unknown>>(appUiStatePath(), {})
  const authorizedRootsStore = new JsonStore<AuthorizedRootsState>(appAuthorizedRootsPath(), {
    roots: []
  })
  const metadata = createMetadataStore()
  const backup = new BackupService(settingsStore)
  const config = new PiConfigService(settingsStore, backup)
  backup.attachConfig(config)
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
  const skills = new SkillsService(settingsStore, packageManager, builtinSkills, access, packageRegistry)
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
    onTask: (task) => deps.events?.onInstallTask?.(task),
    onEnvironmentChanged: (env) => deps.events?.onEnvironmentChanged?.(env)
  })

  if (deps.sessions && deps.agent) {
    const sessions = deps.sessions
    const agent = deps.agent
    diagnostics.attachWorkspace({
      sessions: {
        sessionsRoot: () => {
          const sdk = peekPiSdk()
          return sdk ? sessions.sessionsRoot(sdk) : ''
        },
        list: () => sessions.list()
      },
      agent: {
        diagnostics: () => agent.diagnostics(),
        listRunning: () => agent.listRunning()
      },
      access
    })
    access.attachSessionLister(() => sessions.list())
  }

  capabilities.onProgress((progress) => deps.events?.onCapabilityProgress?.(progress))
  if (!process.env.VITEST && process.env.NODE_ENV !== 'test') {
    config.startWatcher(() => deps.events?.onConfigChanged?.({ at: Date.now() }))
  }

  let mutation: 'env' | 'package' | null = null

  const services: DesktopServices = {
    settingsStore,
    uiStateStore,
    backup,
    config,
    providers,
    models,
    skills,
    capabilities,
    diagnostics,
    environment,
    access,
    packageManager,
    piProcess,
    async runMutation(kind, fn) {
      if (mutation && mutation !== kind) {
        const { EnvironmentError } = await import('./desktop/services/errors.js')
        throw new EnvironmentError(
          'COMMAND_FAILED',
          mutation === 'env'
            ? 'An environment install is already running'
            : 'A package mutation is already running'
        )
      }
      const previous = mutation
      mutation = kind
      try {
        return await fn()
      } finally {
        mutation = previous
      }
    },
    async shutdown() {
      config.stopWatcher()
    }
  }

  void Promise.all([
    settingsStore.read(),
    uiStateStore.read(),
    authorizedRootsStore.read(),
    metadata.read(),
    config.read().catch(() => undefined)
  ])

  void logFilePath
  return services
}

/**
 * Typed IPC API surface. This is the shape of `window.piSwitch` exposed by the
 * preload bridge. The renderer imports these types and the PiSwitchAPI symbol;
 * it never calls `invoke("...")` with a raw string.
 */

import type { AppErrorCode, AppErrorPayload } from '../types/errors'
import type {
  ProviderProfile,
  ModelDefinition,
  ActiveModel,
  ApiKeySpec,
  DiscoveredProviderModel,
  ProviderModelDiscoveryInput
} from '../types/domain'

import type { ProtocolId } from '../constants/protocols'
import type { AppTheme } from '../constants/theme'
import type {
  AgentStateSnapshot,
  AgentWorkspace,
  FilePreview,
  FileSearchHit,
  FileSearchScope,
  FileTreeEntry,
  FileWriteResult,
  GitFileDiffResponse,
  GitCommitInfo,
  GitCommitDetails,
  GitCommitDiffResponse,
  GitCommitMessageResponse,
  GitCommitResponse,
  GitActionRequest,
  GitActionResponse,
  GitBranchContextAction,
  GitContextMenuSelection,
  GitRepositoryOverview,
  GitStatusResponse,
  PromptAgentInput,
  ProjectContextAction,
  RecentWorkspace,
  SessionContext,
  SessionContextAction,
  SessionFolderContextAction,
  SessionDetail,
  SessionInfo,
  SessionProjectGroup,
  SessionWorkspaceBinding,
  StartAgentSessionInput,
  WorkspaceFolderRole,
  WorkspaceFolderSnapshot,
  WorktreeInfo
} from '../types/workspace'
import type { ToolPreset } from '../workspace/tool-presets'
import type {
  HarnessCompactionResult,
  HarnessEvent,
  HarnessForkResult,
  HarnessSessionInfo,
  HarnessState,
  HarnessStats,
  HarnessTool
} from '../types/harness'
import type { MascotStyle } from '../constants/mascot'
import type { NavItemId } from '../constants/navigation'
import type {
  CapabilityActionResult,
  CapabilityDescriptor,
  CapabilityMutationProgress
} from '../capabilities/types'

/** Legacy renderer-side Error envelope accepted by the API error normalizer. */
export interface IpcError extends Error {
  payload: AppErrorPayload
}

export interface PiEnvironment {
  installed: boolean
  cliPath: string | null
  version: string | null
  homeDir: string | null
  configDir: string | null
  modelsConfigPath: string | null
  settingsPath: string | null
  modelsStorePath: string | null
  authPath: string | null
  skillsDirs: string[]
  configReadable: boolean
  configWritable: boolean
  configValid: boolean
  configError: string | null
  platform: NodeJS.Platform | string
  arch: string
  nodeRuntime: NodeRuntimeInfo
  state: EnvironmentState
  piStatus: RuntimeStatus
  checks: EnvironmentCheckResult[]
}

export type EnvironmentCheckStatus = 'healthy' | 'warning' | 'error'

export interface EnvironmentCheckResult {
  id: 'node' | 'npm' | 'pnpm' | 'pi' | 'path' | 'config-directory' | 'skills-directory'
  status: EnvironmentCheckStatus
  installed: boolean
  version: string | null
  path: string | null
  message: string
  remediation?: string
}

export type RuntimeStatus = 'checking' | 'missing' | 'outdated' | 'ready' | 'installing' | 'failed'

export type EnvironmentState =
  | 'checking'
  | 'node-required'
  | 'node-outdated'
  | 'node-installing'
  | 'npm-unavailable'
  | 'pi-required'
  | 'pi-installing'
  | 'ready'
  | 'failed'

export interface NodeRuntimeInfo {
  nodeInstalled: boolean
  nodePath: string | null
  nodeVersion: string | null
  npmInstalled: boolean
  npmPath: string | null
  npmVersion: string | null
  pnpmInstalled: boolean
  pnpmPath: string | null
  pnpmVersion: string | null
  nodeSupported: boolean
  minimumNodeVersion: string
  nodeStatus: RuntimeStatus
  npmStatus: RuntimeStatus
  nodeSource: CommandResolutionSource | null
  npmSource: CommandResolutionSource | null
  pnpmSource: CommandResolutionSource | null
  npmPrefix: string | null
  npmPrefixWritable: boolean | null
  npmBinDir: string | null
  resolvedPath: string
  /** True when Node.js >= the minimum version and npm are executable. */
  ready: boolean
}

export type CommandResolutionSource =
  'explicit' | 'managed-runtime' | 'candidate' | 'process-path' | 'login-shell' | 'system-locator'

export type EnvironmentInstallTaskType = 'node' | 'pi' | 'environment'
export type EnvironmentInstallTaskState = 'pending' | 'running' | 'success' | 'failed' | 'cancelled'

export interface EnvironmentInstallLog {
  at: number
  level: 'info' | 'stdout' | 'stderr' | 'warning' | 'error'
  message: string
}

export interface EnvironmentInstallTask {
  id: string
  type: EnvironmentInstallTaskType
  state: EnvironmentInstallTaskState
  phase: string
  progress: number
  message: string
  logs: EnvironmentInstallLog[]
  startedAt: number | null
  finishedAt: number | null
  cancellable: boolean
  error: AppErrorPayload | null
  result: PiInstallResult | null
}

export interface PiVersionInfo {
  cli: string | null
  version: string | null
}

export interface PiLatestInfo {
  installed: boolean
  installedVersion: string | null
  latestVersion: string | null
  updateAvailable: boolean
  packageName: string
}

export interface PiInstallResult {
  ok: boolean
  action: 'install' | 'update'
  previousVersion: string | null
  currentVersion: string | null
  latestVersion: string | null
  message: string
  log: string
}

export interface ConfigStatus {
  modelsPath: string
  settingsPath: string
  modelsExists: boolean
  settingsExists: boolean
  modelsValid: boolean
  settingsValid: boolean
  lastError: string | null
  lastReadAt: number | null
  lastMtime: number | null
}

export interface RawConfig {
  path: string
  content: string
  mtime: number | null
}

/**
 * Configuration Conflict Dialog payload.
 * `lastLoaded` is what Pi-Harness last established as its baseline (read or write).
 * `currentDisk` is a fresh read of the file at the moment of the conflict.
 */
export interface ConfigConflictSnapshot {
  file: 'models' | 'settings'
  path: string
  lastLoaded: string
  currentDisk: string
  lastMtime: number | null
  currentMtime: number | null
}

export interface SkillInfo {
  name: string
  description: string
  path: string
  source: string
  isValid: boolean
  issues: string[]
  lastModified: number | null
  hasReadme: boolean
  /** Package-provided skills are inspectable but must be managed through Pi packages. */
  readOnly?: boolean
  origin?: 'local' | 'package' | 'builtin'
  packageSource?: string
  scope?: 'global' | 'project' | 'shared' | 'unknown'
  packageId?: string
  packageName?: string
  packageVersion?: string | null
  packageType?: PiPackageSourceType
  packagePath?: string | null
  packageScope?: PiPackageScope
  registryPath?: string | null
  builtinCollectionId?: string
  builtinCollectionName?: string
  builtinCategory?: BuiltinSkillCategory
  builtinRepository?: string
  bundledPath?: string
  bundledCommit?: string
  builtinHealth?: BuiltinSkillHealth
}

export interface PiPackageResources {
  skills: string[]
  prompts: string[]
  extensions: string[]
  themes: string[]
  tools: string[]
}

export type PiPackageSourceType = 'npm' | 'git' | 'local' | 'builtin' | 'unknown'
export type PiPackageScope = 'global' | 'project'
export type PiPackageHealth =
  'healthy' | 'missing' | 'orphaned' | 'permission-error' | 'corrupted' | 'unknown'

export type PiPackageProblemCode =
  | 'FILES_MISSING'
  | 'ORPHANED_FILES'
  | 'PERMISSION_ERROR'
  | 'MANIFEST_MISSING'
  | 'MANIFEST_INVALID'
  | 'DEPENDENCY_MISSING'
  | 'UNKNOWN_SOURCE'
  | 'REGISTRY_MISMATCH'

export interface PiPackageProblem {
  code: PiPackageProblemCode
  message: string
  path: string | null
  recoverable: boolean
}

export interface PiPackagePermission {
  path: string
  exists: boolean
  readable: boolean
  writable: boolean
  executable: boolean
  ownerUid: number | null
  currentUid: number | null
  ownerMatches: boolean | null
  problem: string | null
}

export interface PiPackageResource {
  type: 'skill' | 'extension' | 'tool' | 'prompt' | 'theme' | 'other'
  name: string
  path: string
  packageId: string
}

export interface PiPackageInfo {
  id: string
  source: string
  name: string
  sourceType: PiPackageSourceType
  scope: PiPackageScope
  projectRoot: string | null
  registered: boolean
  registryPath: string
  version: string | null
  description: string
  path: string | null
  installed: boolean
  available: boolean
  healthy: boolean
  health: PiPackageHealth
  managed: boolean
  resources: PiPackageResources
  resourceItems: PiPackageResource[]
  problems: PiPackageProblem[]
  permissions: PiPackagePermission[]
}

export interface SkillMarketPackage {
  source: string
  name: string
  description: string
  installed: boolean
  installedVersion: string | null
}

export interface PackageSkillMarketCollection {
  id: string
  kind: 'bundle' | 'guide'
  packages: SkillMarketPackage[]
}

export type BuiltinSkillCategory = 'engineering' | 'productivity' | 'misc'
export type BuiltinSkillRole =
  'uiDesigner' | 'frontendEngineer' | 'backendEngineer' | 'productEngineer'

export type BuiltinSkillHealth =
  | 'not-installed'
  | 'healthy'
  | 'missing'
  | 'modified'
  | 'conflict'
  | 'corrupted'
  | 'update-available'

export interface BuiltinSkillInstallation {
  scope: PiPackageScope
  projectRoot: string | null
  installedPath: string
  installedAt: string | null
  sourceCommit: string
  sourceHash: string
  installedHash: string | null
  installed: boolean
  owned: boolean
  modified: boolean
  updateAvailable: boolean
  health: BuiltinSkillHealth
}

export interface BuiltinSkillInfo {
  id: string
  name: string
  description: string
  collectionId: string
  category: BuiltinSkillCategory
  source: 'builtin'
  sourceRepository: string
  sourcePath: string
  bundledPath: string
  bundledHash: string
  bundledHealthy: boolean
  commit: string
  resources: string[]
  installations: BuiltinSkillInstallation[]
}

export interface BuiltinSkillMarketCollection {
  id: string
  kind: 'builtin-skills'
  role?: BuiltinSkillRole
  name: string
  displayName: string
  author: string
  repository: string
  license: string
  commit: string
  source: 'builtin'
  skills: BuiltinSkillInfo[]
}

export type SkillMarketCollection = PackageSkillMarketCollection | BuiltinSkillMarketCollection

export interface BuiltinSkillMutationTarget {
  collectionId: string
  skillIds: string[]
  scope: PiPackageScope
  projectRoot?: string | null
  overwrite?: boolean
}

export interface BuiltinSkillActionResult {
  collectionId: string
  skillId: string
  scope: PiPackageScope
  action: 'install' | 'update' | 'uninstall'
  ok: boolean
  skipped: boolean
  message: string
  installedPath: string | null
  backupPath: string | null
  errorCode: AppErrorCode | null
  logs: { phase: string; ok: boolean; message: string; path?: string }[]
}

export interface PiPackageActionResult {
  source: string
  scope: PiPackageScope
  action: 'install' | 'repair' | 'register' | 'uninstall' | 'delete-orphan'
  ok: boolean
  skipped: boolean
  message: string
  stdout: string
  stderr: string
  errorCode: 'EACCES' | 'PROCESS_FAILED' | 'VERIFY_FAILED' | null
  logs: { phase: string; ok: boolean; message: string; path?: string }[]
}

export interface PiPackageTarget {
  source: string
  scope: PiPackageScope
  projectRoot?: string | null
}

export interface PiPackageCleanupPlan {
  packages: PiPackageTarget[]
  orphanPackages: PiPackageTarget[]
  standaloneSkills: { path: string; name: string; scope: SkillInfo['scope'] }[]
  totals: { npm: number; git: number; local: number; orphaned: number; skills: number }
  preserved: string[]
}

export interface PiPackageCleanupResult {
  plan: PiPackageCleanupPlan
  packageResults: PiPackageActionResult[]
  removedSkills: string[]
  failures: { target: string; message: string }[]
}

export interface BackupRecord {
  id: string
  timestamp: number
  reason: string
  source: string
  files: string[]
  sizeBytes: number
  appVersion: string
  configVersion: string | null
}

export interface DiagnosticsReport {
  app: { version: string; electron: string; chrome: string; node: string }
  environment: {
    state: EnvironmentState
    piStatus: RuntimeStatus
    nodeRuntime: NodeRuntimeInfo
    checks: EnvironmentCheckResult[]
  }
  pi: {
    installed: boolean
    version: string | null
    cliPath: string | null
    configDir: string | null
    configPath: string | null
    skillsPath: string | null
    skillsDirs: string[]
    configValid: boolean
    readPermission: boolean
    writePermission: boolean
  }
  system: {
    platform: string
    arch: string
    shell: string | null
    homeDir: string | null
    pathSummary: string
    secretBackend: 'keychain' | 'safeStorage' | 'unavailable'
  }
  storage: {
    config: { path: string | null; writable: boolean }
    sessions: { path: string; writable: boolean }
    skills: { paths: string[]; writable: boolean }
  }
  security: {
    secretStoreAvailable: boolean
    backend: 'keychain' | 'safeStorage' | 'unavailable'
    trustedIpcSenders: boolean
    contextIsolation: boolean
    nodeIntegration: boolean
  }
  git: {
    installed: boolean
    version: string | null
    path: string | null
  }
  capabilities: {
    registryCount: number
    installedCount: number
    healthyCount: number
    builtinSkillCount: number
  }
  config: ConfigStatus
  packages: {
    registryCount: number
    installedCount: number
    healthyCount: number
    missingCount: number
    orphanedCount: number
    corruptedCount: number
    permissionErrorCount: number
    skillsCount: number
    startupRisk: boolean
    registryPaths: string[]
    permissions: PiPackagePermission[]
  }
  workspace: {
    sessionRoot: string
    sessionCount: number
    runningSessions: string[]
    piSdkLoaded: boolean
    runtime: 'pi'
    currentWorkspace: string | null
    writable: boolean | null
    allowedRootCount: number
  }
}

export interface AppSettings {
  language: 'auto' | 'zh-CN' | 'en-US'
  theme: AppTheme
  mascotUnlocked: boolean
  mascotStyle: MascotStyle
  petAnimations: boolean
  petStatusText: boolean
  petAutoSleep: boolean
  petSleepMinutes: number
  petSound: boolean
  mockMode: boolean
  manualCliPath: string | null
  manualConfigDir: string | null
  autoBackup: boolean
  backupRetention: number
  developerMode: boolean
  defaultToolPreset: ToolPreset
  restoreTabs: boolean
  autoOpenLastProject: boolean
  windowMotionEnabled: boolean
  screenMotionEnabled: boolean
  navOrder: NavItemId[]
}

export interface NotificationEvent {
  level: 'info' | 'success' | 'warning' | 'error'
  title: string
  message?: string
}

export interface ConnectionTestResult {
  ok: boolean
  status:
    | 'success'
    | 'auth_error'
    | 'forbidden'
    | 'rate_limited'
    | 'network_error'
    | 'endpoint_error'
    | 'timeout'
    | 'model_not_found'
    | 'model_error'
    | 'protocol_error'
    | 'invalid_response'
    | 'unknown_error'
  httpStatus: number | null
  latencyMs: number
  message: string
  /** Sanitized resolved endpoint (no secrets). */
  endpoint?: string | null
  protocol?: string | null
  modelId?: string | null
}

export interface SystemInfo {
  platform: string
  arch: string
  versions: { electron: string; chrome: string; node: string }
  appVersion: string
  /** True when running from an installed / electron-builder package (not `pnpm dev`). */
  packaged: boolean
}

export type AppUpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'manual-update'
  | 'error'

export interface AppUpdateState {
  /** False for local development; application updates apply only to installed builds. */
  supported: boolean
  available: boolean
  currentVersion: string
  latestVersion: string | null
  status: AppUpdateStatus
  downloaded: boolean
  downloadProgress: number | null
}

/** Listener for main→renderer push events. */
export type IpcEventListener = (payload: unknown) => void

export interface ScreenMotionActivePayload {
  active: boolean
  theme: 'dark' | 'light'
}

export interface PiSwitchOverlayAPI {
  onActive(listener: (payload: ScreenMotionActivePayload) => void): () => void
}

/**
 * The full typed bridge. Each method returns a Promise and rejects with a
 * structured AppErrorPayload on failure.
 */
export interface PiSwitchAPI {
  // system
  system: {
    info(): Promise<SystemInfo>
    openPath(path: string): Promise<void>
    showItem(path: string): Promise<void>
  }
  pi: {
    detect(): Promise<PiEnvironment>
    getVersion(): Promise<PiVersionInfo>
    runHelp(): Promise<string>
    checkLatest(): Promise<PiLatestInfo>
    /** One-click install — only when Pi is missing. */
    install(): Promise<PiInstallResult>
    /** Install/repair Node, npm, and Pi as one guarded task. */
    bootstrap(): Promise<PiInstallResult>
    installNode(): Promise<EnvironmentInstallTask>
    reinstall(): Promise<PiInstallResult>
    getInstallTask(): Promise<EnvironmentInstallTask | null>
    cancelInstall(): Promise<EnvironmentInstallTask | null>
    /** Update installed Pi (`pi update --self`). */
    update(force?: boolean): Promise<PiInstallResult>
    copyInstallCommand(): Promise<string>
    openNodeDownload(): Promise<void>
  }
  providers: {
    list(): Promise<ProviderProfile[]>
    get(key: string): Promise<ProviderProfile | null>
    create(form: unknown, options?: { overwrite?: boolean }): Promise<ProviderProfile>
    update(key: string, form: unknown, options?: { overwrite?: boolean }): Promise<ProviderProfile>
    delete(key: string, options?: { overwrite?: boolean }): Promise<void>
    duplicate(key: string, options?: { overwrite?: boolean }): Promise<ProviderProfile>
    setEnabled(key: string, enabled: boolean): Promise<ProviderProfile>
    testConnection(input: unknown): Promise<ConnectionTestResult>
    discoverModels(input: ProviderModelDiscoveryInput): Promise<DiscoveredProviderModel[]>
  }
  models: {
    list(): Promise<ModelDefinition[]>
    create(form: unknown, options?: { overwrite?: boolean }): Promise<ModelDefinition>
    update(id: string, form: unknown, options?: { overwrite?: boolean }): Promise<ModelDefinition>
    delete(id: string, options?: { overwrite?: boolean }): Promise<void>
    setActive(input: unknown, options?: { overwrite?: boolean }): Promise<ActiveModel>
    getActive(): Promise<ActiveModel>
  }
  config: {
    read(): Promise<RawConfig>
    readRaw(file: 'models' | 'settings'): Promise<RawConfig>
    writeRaw(
      file: 'models' | 'settings',
      content: string,
      options?: { overwrite?: boolean }
    ): Promise<void>
    readSettings(): Promise<RawConfig>
    reload(): Promise<ConfigStatus>
    getStatus(): Promise<ConfigStatus>
    /** Snapshot used by the Configuration Conflict Dialog. */
    conflictSnapshot(file: 'models' | 'settings'): Promise<ConfigConflictSnapshot>
  }
  skills: {
    list(projectRoot?: string | null): Promise<SkillInfo[]>
    packages(projectRoot?: string | null): Promise<PiPackageInfo[]>
    market(projectRoot?: string | null): Promise<SkillMarketCollection[]>
    installBuiltinSkills(target: BuiltinSkillMutationTarget): Promise<BuiltinSkillActionResult[]>
    updateBuiltinSkills(target: BuiltinSkillMutationTarget): Promise<BuiltinSkillActionResult[]>
    uninstallBuiltinSkills(target: BuiltinSkillMutationTarget): Promise<BuiltinSkillActionResult[]>
    installPackages(targets: PiPackageTarget[]): Promise<PiPackageActionResult[]>
    repairPackage(target: PiPackageTarget): Promise<PiPackageActionResult>
    registerPackage(target: PiPackageTarget): Promise<PiPackageActionResult>
    removePackages(targets: PiPackageTarget[]): Promise<PiPackageActionResult[]>
    removePackage(target: PiPackageTarget): Promise<PiPackageActionResult>
    deleteOrphanPackage(target: PiPackageTarget): Promise<PiPackageActionResult>
    cleanupPlan(projectRoot?: string | null): Promise<PiPackageCleanupPlan>
    cleanupThirdParty(projectRoot?: string | null): Promise<PiPackageCleanupResult>
    repairPermissions(projectRoot?: string | null): Promise<PiPackagePermission[]>
    read(path: string): Promise<{ content: string; mtime: number | null }>
    create(form: unknown): Promise<SkillInfo>
    update(form: unknown): Promise<SkillInfo>
    import(input: unknown): Promise<SkillInfo>
    validate(
      form: unknown
    ): Promise<{ valid: boolean; issues: { level: string; message: string }[] }>
    delete(path: string): Promise<void>
    refresh(): Promise<SkillInfo[]>
  }
  capabilities: {
    list(): Promise<CapabilityDescriptor[]>
    installSkill(skillId: string): Promise<CapabilityActionResult>
    updateSkill(skillId: string): Promise<CapabilityActionResult>
    uninstallSkill(skillId: string): Promise<CapabilityActionResult>
    setSkillEnabled(skillId: string, enabled: boolean): Promise<CapabilityActionResult>
  }
  backup: {
    list(): Promise<BackupRecord[]>
    create(reason?: string): Promise<BackupRecord>
    restore(id: string): Promise<void>
    delete(id: string): Promise<void>
    /** Keep the newest `retention` backups; delete the rest. */
    pruneToRetention(retention: number): Promise<{ deleted: number; freedBytes: number }>
    openFolder(): Promise<void>
  }
  settings: {
    get(): Promise<AppSettings>
    set(patch: Partial<AppSettings>): Promise<AppSettings>
    unlockMascot(answer: string): Promise<boolean>
    getUiState(): Promise<Record<string, unknown>>
    setUiState(state: Record<string, unknown>): Promise<void>
  }
  diagnostics: {
    get(): Promise<DiagnosticsReport>
    copy(): Promise<string>
    export(): Promise<string>
  }
  logs: {
    read(): Promise<string>
    openFolder(): Promise<void>
  }
  updater: {
    state(): Promise<AppUpdateState>
    check(): Promise<AppUpdateState>
    download(): Promise<AppUpdateState>
    install(): Promise<void>
    openReleasePage(): Promise<void>
  }
  window: {
    minimize(): Promise<void>
    maximizeToggle(): Promise<void>
    close(): Promise<void>
  }
  workspace: {
    listProjects(): Promise<SessionProjectGroup[]>
    pickDirectory(): Promise<string | null>
    pickWorkspaceSources(): Promise<string[]>
    pickWorkspaceFile(): Promise<string | null>
    saveWorkspaceFile(): Promise<string | null>
    allowRoot(root: string): Promise<void>
    projectContextMenu(
      projectKey: string,
      projectRoot: string,
      isPinned?: boolean,
      locale?: 'zh-CN' | 'en-US'
    ): Promise<ProjectContextAction | null>
    sessionFolderContextMenu(locale?: 'zh-CN' | 'en-US'): Promise<SessionFolderContextAction | null>
    getPathForFile(file: unknown): Promise<string>
    getActive(): Promise<AgentWorkspace | null>
    sync(input: {
      workspaceFile?: string | null
      folders: Array<{
        path: string
        resolvedPath?: string
        name?: string
        role?: WorkspaceFolderRole
        readonly?: boolean
      }>
      settings?: Record<string, unknown>
    }): Promise<AgentWorkspace>
    openWorkspaceFile(path: string): Promise<AgentWorkspace>
    save(input: {
      path?: string
      folders: Array<{
        path: string
        resolvedPath?: string
        name?: string
        role?: WorkspaceFolderRole
        readonly?: boolean
      }>
      settings?: Record<string, unknown>
      workspaceFile?: string | null
    }): Promise<AgentWorkspace>
    search(query: string, scope?: FileSearchScope, folderId?: string): Promise<FileSearchHit[]>
    openInTerminal(directory: string): Promise<void>
    relocateFolder(folderId: string, path: string): Promise<AgentWorkspace>
    listRecent(): Promise<RecentWorkspace[]>
    bindSession(
      sessionId: string,
      workspaceId: string,
      folders: WorkspaceFolderSnapshot[],
      mainFolderId?: string
    ): Promise<void>
    getSessionBinding(sessionId: string): Promise<SessionWorkspaceBinding | null>
    listSessionBindings(): Promise<Record<string, SessionWorkspaceBinding>>
  }
  sessions: {
    list(force?: boolean): Promise<SessionInfo[]>
    get(sessionId: string): Promise<SessionDetail>
    rename(sessionId: string, name: string): Promise<void>
    delete(sessionId: string): Promise<void>
    context(sessionId: string, leafId?: string | null): Promise<SessionContext>
    export(sessionId: string, format: 'html' | 'markdown'): Promise<string | null>
    exportProject(
      name: string,
      sessionIds: string[],
      format: 'html' | 'markdown'
    ): Promise<string | null>
    viewFullHistory(sessionId: string): Promise<SessionDetail>
    contextMenu(
      sessionId: string,
      isWorktree?: boolean,
      isPinned?: boolean,
      locale?: 'zh-CN' | 'en-US'
    ): Promise<SessionContextAction | null>
  }
  agent: {
    start(input: StartAgentSessionInput): Promise<{ sessionId: string; cwd: string }>
    prompt(input: PromptAgentInput): Promise<unknown>
    abort(sessionId: string): Promise<void>
    state(sessionId: string): Promise<AgentStateSnapshot | null>
    running(): Promise<string[]>
    command(sessionId: string, command: Record<string, unknown>): Promise<unknown>
  }
  harness: {
    state(sessionId: string): Promise<HarnessState | null>
    tools(sessionId: string): Promise<HarnessTool[]>
    setTools(sessionId: string, toolNames: string[]): Promise<void>
    setModel(sessionId: string, provider: string, modelId: string): Promise<void>
    setThinkingLevel(sessionId: string, level: string): Promise<void>
    compact(sessionId: string, instructions?: string): Promise<HarnessCompactionResult | unknown>
    abortCompaction(sessionId: string): Promise<void>
    setAutoCompaction(sessionId: string, enabled: boolean): Promise<void>
    steer(sessionId: string, message: string): Promise<void>
    followUp(sessionId: string, message: string): Promise<void>
    fork(sessionId: string, entryId: string): Promise<HarnessForkResult>
    navigateTree(sessionId: string, entryId: string): Promise<unknown>
    session(sessionId: string): Promise<HarnessSessionInfo>
    stats(sessionId: string): Promise<HarnessStats>
    timeline(sessionId: string): Promise<HarnessEvent[]>
  }
  files: {
    list(directory: string): Promise<FileTreeEntry[]>
    read(path: string): Promise<FilePreview>
    write(
      path: string,
      text: string,
      expectedRevision: string,
      overwrite?: boolean
    ): Promise<FileWriteResult>
    upload(
      directory: string,
      fileName: string,
      dataBase64: string,
      overwrite?: boolean
    ): Promise<{ path: string }>
  }
  git: {
    status(cwd: string): Promise<GitStatusResponse>
    statusMany(cwds: string[]): Promise<GitStatusResponse[]>
    diff(cwd: string, filePath: string): Promise<GitFileDiffResponse>
    stage(cwd: string, filePaths: string[]): Promise<void>
    unstage(cwd: string, filePaths: string[]): Promise<void>
    generateCommitMessage(cwd: string, draft?: string): Promise<GitCommitMessageResponse>
    commit(cwd: string, message: string): Promise<GitCommitResponse>
    history(cwd: string, limit?: number): Promise<GitCommitInfo[]>
    overview(cwd: string): Promise<GitRepositoryOverview>
    commitDetails(cwd: string, hash: string): Promise<GitCommitDetails>
    commitDiff(cwd: string, hash: string, filePath: string): Promise<GitCommitDiffResponse>
    action(input: GitActionRequest): Promise<GitActionResponse>
    branchContextMenu(input: {
      locale: 'zh-CN' | 'en-US'
      branchName: string
      branchType: 'local' | 'remote'
      current: boolean
      upstream: string | null
      upstreamChoices: string[]
    }): Promise<GitContextMenuSelection<GitBranchContextAction> | null>
  }
  worktrees: {
    list(cwd: string): Promise<WorktreeInfo[]>
    create(cwd: string, branch: string): Promise<{ path: string; branch: string }>
    remove(cwd: string, worktreePath: string, force?: boolean): Promise<void>
  }
  aiMotion: {
    setActive(input: ScreenMotionActivePayload): Promise<void>
  }
  on(event: 'config-changed', listener: IpcEventListener): () => void
  on(event: 'pi-environment-changed', listener: IpcEventListener): () => void
  on(
    event: 'environment-install-task',
    listener: (payload: EnvironmentInstallTask) => void
  ): () => void
  on(event: 'notification', listener: IpcEventListener): () => void
  on(event: 'agent-event', listener: IpcEventListener): () => void
  on(event: 'agent-running', listener: IpcEventListener): () => void
  on(event: 'harness-event', listener: IpcEventListener): () => void
  on(event: 'updater-state', listener: IpcEventListener): () => void
  on(
    event: 'capability-progress',
    listener: (payload: CapabilityMutationProgress) => void
  ): () => void
  on(event: 'workspace-changed', listener: IpcEventListener): () => void
}

declare global {
  interface Window {
    piSwitch?: PiSwitchAPI
    piSwitchOverlay?: PiSwitchOverlayAPI
  }
}

export type {
  ProviderProfile,
  ModelDefinition,
  ActiveModel,
  ApiKeySpec,
  DiscoveredProviderModel,
  ProviderModelDiscoveryInput,
  ProtocolId
}

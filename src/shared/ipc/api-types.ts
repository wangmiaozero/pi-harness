import type { AgentSettingsAPI } from '../agent-settings/schema'
import type { HarnessPluginsAPI } from '../harness-plugins/types'
import type { DesktopPetSettings, PetPackDetail, PetPackInstallResult, PetPackManifest, PetPackSummary } from '../pet/desktop'
import type { PetEvent } from '../pet/types'
import type { OpenCodeFreeState, OpenCodeTestOptions } from '../providers/opencode-free'
import type {
  RuntimeDiagnostics,
  RuntimeKind,
  RuntimeSelection,
  RuntimeUpdateReport
} from '../runtime/schema'
/**
 * Typed IPC API surface. This is the shape of `window.piSwitch` exposed by the
 * preload bridge. The renderer imports these types and the PiSwitchAPI symbol;
 * it never calls `invoke("...")` with a raw string.
 */

import type { AppErrorCode, AppErrorPayload } from '../types/errors'
import type { UniversalSessionsAPI } from '../universal/schema'
import type { ProjectIntelligenceAPI } from '../intelligence/schema'
import type {
  ProviderProfile,
  ModelDefinition,
  ActiveModel,
  ApiKeySpec,
  DiscoveredProviderModel,
  ProviderModelDiscoveryInput
} from '../types/domain'

import type { AppLanguage } from '../constants/language'
import type { ProtocolId } from '../constants/protocols'
import type { AppTheme } from '../constants/theme'
import type { MacOS27Background } from '../constants/macos27-background'
import type { AppIconPreference } from '../constants/app-icon'
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
import type { PermissionMode } from '../workspace/permission-mode'
import type { AgentMode } from '../workspace/agent-mode'
import type {
  AgentHandoff,
  AgentTemplate,
  HarnessAgent,
  HarnessArtifact,
  HarnessBaseline,
  HarnessCheckpoint,
  HarnessCompactionResult,
  HarnessEvent,
  HarnessEvaluation,
  HarnessExportResult,
  HarnessForkResult,
  HarnessOrchestrationBudget,
  HarnessOrchestrationRun,
  HarnessOrchestrationSnapshot,
  HarnessOrchestrationStrategy,
  HarnessPolicyConfig,
  HarnessPolicySnapshot,
  HarnessProjectStats,
  HarnessRun,
  HarnessRunComparison,
  HarnessRunDetail,
  HarnessRunTreeNode,
  HarnessSessionInfo,
  HarnessState,
  HarnessStats,
  HarnessStatsRange,
  HarnessStoreSettings,
  HarnessTask,
  HarnessTaskPriority,
  HarnessTeam,
  HarnessTool
} from '../types/harness'
import type { MascotStyle } from '../constants/mascot'
import type { CustomSkinDescriptor, CustomSkinProjectResult } from '../types/custom-skin'
import type { NavItemId } from '../constants/navigation'
import type { ProjectLinkTarget } from '../constants'
import type {
  CapabilityActionResult,
  CapabilityDescriptor,
  CapabilityMutationProgress
} from '../capabilities/types'

/** Legacy renderer-side Error envelope accepted by the API error normalizer. */
export interface IpcError extends Error {
  payload: AppErrorPayload
}

/**
 * Session cleanup scope. Time-based scopes use the session's last activity
 * time so recently active conversations are never swept.
 */

export type SessionCleanupScope = 'current-project' | 'older-30d' | 'older-90d' | 'all'

export interface SessionCleanupPreviewOptions {
  scope: SessionCleanupScope
  /** Required when scope is `current-project` (project identity key). */
  projectKey?: string
  /** Protect pinned sessions. Defaults to true on Main when omitted. */
  keepPinned?: boolean
  /** Pinned session ids from the Renderer workspace state; only ever widens protection. */
  pinnedSessionIds?: string[]
}

export interface SessionCleanupCandidate {
  sessionId: string
  name?: string
  projectName?: string
  modified: string
  /** Real on-disk size of the JSONL session file, measured with fs.stat. */
  sizeBytes: number
}

export interface SessionCleanupPreview {
  previewToken: string
  scope: SessionCleanupScope
  candidates: SessionCleanupCandidate[]
  totalBytes: number
  affectedProjects: number
  excludedRunning: number
  excludedPinned: number
  excludedUnsafe: number
  expiresAt: number
}

export interface SessionCleanupError {
  sessionId: string
  message: string
}

export interface SessionCleanupResult {
  requested: number
  deleted: number
  failed: number
  /** Real bytes freed by successful unlink calls — never an estimate. */
  freedBytes: number
  skippedRunning: number
  skippedPinned: number
  skippedChanged: number
  skippedMissing: number
  deletedSessionIds: string[]
  errors: SessionCleanupError[]
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
  nodeSecurity?: import('../runtime/node-security-policy.mjs').NodeSecurityAssessment
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
  /** True when Node.js meets compatibility/security policy and npm is executable. */
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

export type PiRegistryPackageType = 'extension' | 'skill' | 'prompt' | 'theme' | 'package'
export type PiRegistrySort = 'downloads' | 'published' | 'relevance'

export interface PiRegistryPackageResources {
  extensions: string[]
  skills: string[]
  prompts: string[]
  themes: string[]
}

export interface PiRegistryPackage {
  name: string
  version: string
  description: string
  keywords: string[]
  publisher: string
  author: string
  maintainers: string[]
  license: string
  homepage: string | null
  repository: string | null
  npmUrl: string
  publishDate: string | null
  monthlyDownloads: number | null
  weeklyDownloads: number | null
  types: PiRegistryPackageType[]
  resources: PiRegistryPackageResources
  detailStatus: 'loaded' | 'failed'
  detailError: string | null
}

export interface PiRegistryPackageDetail extends PiRegistryPackage {
  latestVersion: string
  dependencies: Record<string, string>
  peerDependencies: Record<string, string>
  dist: {
    tarball: string | null
    shasum: string | null
    integrity: string | null
    unpackedSize: number | null
  }
  piManifest: Record<string, unknown> | null
}

export interface PiPackageSearchInput {
  query?: string
  page?: number
  pageSize?: number
  type?: PiRegistryPackageType | 'all'
  sort?: PiRegistrySort
  refresh?: boolean
}

export interface PiPackageSearchResult {
  items: PiRegistryPackage[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  fetchedAt: number
}

export type PiPackageUpdateState =
  'up-to-date' | 'update-available' | 'fixed-version' | 'check-failed' | 'not-applicable'

export interface PiPackageUpdateInfo {
  packageId: string
  source: string
  scope: PiPackageScope
  installedVersion: string | null
  latestVersion: string | null
  updateAvailable: boolean
  state: PiPackageUpdateState
  error: string | null
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
  action:
    | 'install'
    | 'repair'
    | 'register'
    | 'uninstall'
    | 'delete-orphan'
    | 'update'
    | 'enable'
    | 'disable'
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
  shortcutOverrides?: Partial<Record<import('../agent-settings/schema').ShortcutId, string[]>>
  language: AppLanguage
  theme: AppTheme
  macos27Background?: MacOS27Background
  macos27BackgroundImage?: string | null
  userName: string
  assistantName: string
  appIcon: AppIconPreference
  mascotUnlocked: boolean
  mascotStyle: MascotStyle
  customSkinId: string | null
  petAnimations: boolean
  petStatusText: boolean
  petAutoSleep: boolean
  petSleepMinutes: number
  petSound: boolean
  chatContentMaxWidth: number
  mockMode: boolean
  manualCliPath: string | null
  manualConfigDir: string | null
  autoBackup: boolean
  backupRetention: number
  developerMode: boolean
  defaultToolPreset: ToolPreset
  defaultPermissionMode: PermissionMode
  defaultAgentMode: AgentMode
  restoreTabs: boolean
  autoOpenLastProject: boolean
  windowMotionEnabled: boolean
  screenMotionEnabled: boolean
  composerFireEnabled: boolean
  desktopPet: DesktopPetSettings
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

export type { AppUpdateState, UpdateStatus as AppUpdateStatus, UpdatePreferences } from '../update'
import type { AppUpdateState, UpdatePreferences } from '../update'

/** Listener for main→renderer push events. */
export type IpcEventListener = (payload: unknown) => void

export interface ScreenMotionActivePayload {
  active: boolean
  theme: 'dark' | 'light'
  kind?: 'glow' | 'burning'
}

export interface PiSwitchOverlayAPI {
  onActive(listener: (payload: ScreenMotionActivePayload) => void): () => void
}

export interface PetStatePushPayload {
  /** Normalized pet events since the last push. */
  events: PetEvent[]
  /** Number of agent sessions currently running (multi-agent aggregation). */
  activeAgents: number
}

export interface PetWindowContextPayload {
  manifest: PetPackManifest
  settings: DesktopPetSettings
  language: AppLanguage
  /** Logical size of the pet window in CSS px. */
  width: number
  height: number
}

export type PetMenuAction =
  | 'open-main'
  | 'open-settings'
  | 'toggle-always-on-top'
  | 'reset-position'
  | 'toggle-reduced-motion'
  | 'hide'
  | 'quit'

export interface PetMovePayload {
  dx: number
  dy: number
}

export interface PetDragEndPayload {
  vx: number
  vy: number
}

export type { PetPackSummary, PetPackDetail, PetPackInstallResult }

export interface UiCommandPayload {
  type: 'open-settings' | 'focus'
}

export interface PiSwitchMoveResult {
  /** Resulting window position (screen coordinates, CSS px). */
  x: number
  y: number
  /** Display work area in screen coordinates (CSS px), for client-side bounce physics. */
  workArea: { x: number; y: number; width: number; height: number }
}

/** Restricted bridge exposed only inside the desktop pet window. */
export interface PiSwitchPetAPI {
  getContext(): Promise<PetWindowContextPayload>
  onState(listener: (payload: PetStatePushPayload) => void): () => void
  onConfig(listener: (payload: PetWindowContextPayload) => void): () => void
  moveBy(payload: PetMovePayload): Promise<PiSwitchMoveResult>
  endDrag(payload: PetDragEndPayload): Promise<PiSwitchMoveResult | null>
  setClickThrough(through: boolean): Promise<void>
  openMain(view?: 'main' | 'settings'): Promise<void>
  menuAction(action: PetMenuAction): Promise<void>
}

/**
 * The full typed bridge. Each method returns a Promise and rejects with a
 * structured AppErrorPayload on failure.
 */
export interface NetworkCheckResult {
  reachable: boolean
  latencyMs: number | null
}

export interface ImageModelRequest {
  providerKey: string
  modelId: string
  prompt: string
  size: '1024x1024' | '768x1360' | '896x1184' | '1360x768' | '1184x896'
  sourceImage?: {
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
    base64: string
    fileName: string
  }
}

export interface ImageModelResult {
  mimeType: string
  base64: string
  revisedPrompt: string | null
  fallbackModelId?: string
  fallbackKind?: 'svg'
}

export interface PasteSaveFileInput {
  name?: string
  mimeType?: string
  data: ArrayBuffer
}

export interface PasteSaveInput {
  sessionId: string | null
  files: PasteSaveFileInput[]
}

export interface PasteSavedFile {
  path: string
  name: string
  kind: 'image' | 'text' | 'file'
}

export interface PasteSaveResult {
  files: PasteSavedFile[]
}

export interface AgentPermissionRequest {
  requestId: string
  sessionId: string
  toolName: string
  summary: string
}

export interface AgentPermissionDecision {
  requestId: string
  approved: boolean
}

export interface PiSwitchAPI {
  agentSettings: AgentSettingsAPI
  harnessPlugins: HarnessPluginsAPI
  runtimes: {
    diagnostics(): Promise<RuntimeDiagnostics>
    switch(kind: RuntimeKind, selection: RuntimeSelection): Promise<RuntimeDiagnostics>
    verify(kind: RuntimeKind): Promise<RuntimeDiagnostics>
    checkUpdates(): Promise<RuntimeUpdateReport>
    update(kind: RuntimeKind): Promise<RuntimeDiagnostics>
    rollback(kind: RuntimeKind): Promise<RuntimeDiagnostics>
    pick(kind: RuntimeKind): Promise<string | null>
  }
  universal: UniversalSessionsAPI
  intelligence: ProjectIntelligenceAPI
  // system
  system: {
    info(): Promise<SystemInfo>
    checkNetwork(): Promise<NetworkCheckResult>
    openPath(path: string): Promise<void>
    showItem(path: string): Promise<void>
    openProjectLink(target: ProjectLinkTarget): Promise<void>
    openExternal(url: string): Promise<void>
    copyText(text: string): Promise<void>
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
    /** Update installed Pi using its detected installation source. */
    update(force?: boolean): Promise<PiInstallResult>
    copyInstallCommand(): Promise<string>
    openNodeDownload(): Promise<void>
  }
  openCodeFree: {
    setWorkspaceVisibility(input: {
      showInWorkspace: boolean
      modelIds: string[]
    }): Promise<OpenCodeFreeState>
    state(): Promise<OpenCodeFreeState>
    configure(input: {
      enabled: boolean
      authMode: 'inference'
      removeCredential?: boolean
      apiKey?: string
      consent: true
    }): Promise<OpenCodeFreeState>
    saveCredential(input: {
      id?: string
      name: string
      apiKey?: string
      consent: true
    }): Promise<OpenCodeFreeState>
    activateCredential(id: string): Promise<OpenCodeFreeState>
    deleteCredential(id: string): Promise<OpenCodeFreeState>
    revealCredential(id: string): Promise<string>
    refresh(): Promise<OpenCodeFreeState>
    test(id: string, options?: OpenCodeTestOptions): Promise<OpenCodeFreeState>
    cancel(): Promise<void>
    select(id: string): Promise<OpenCodeFreeState>
    docs(): Promise<void>
    keys(): Promise<void>
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
    revealApiKey(key: string): Promise<string>
  }
  models: {
    list(): Promise<ModelDefinition[]>
    create(form: unknown, options?: { overwrite?: boolean }): Promise<ModelDefinition>
    update(id: string, form: unknown, options?: { overwrite?: boolean }): Promise<ModelDefinition>
    delete(id: string, options?: { overwrite?: boolean }): Promise<void>
    setActive(input: unknown, options?: { overwrite?: boolean }): Promise<ActiveModel>
    getActive(): Promise<ActiveModel>
    invokeImage(input: ImageModelRequest): Promise<ImageModelResult>
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
    searchRegistry(input: PiPackageSearchInput): Promise<PiPackageSearchResult>
    getRegistryPackageDetail(name: string, refresh?: boolean): Promise<PiRegistryPackageDetail>
    checkPackageUpdates(projectRoot?: string | null): Promise<PiPackageUpdateInfo[]>
    updatePackage(target: PiPackageTarget): Promise<PiPackageActionResult>
    updateAllPackages(projectRoot?: string | null): Promise<PiPackageActionResult[]>
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
    openHomepage(skillId: string): Promise<void>
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
  skins: {
    list(): Promise<CustomSkinDescriptor[]>
    import(): Promise<CustomSkinDescriptor | null>
    createProject(): Promise<CustomSkinProjectResult | null>
  }
  pets: {
    list(): Promise<PetPackSummary[]>
    detail(id: string): Promise<PetPackDetail | null>
    /** Opens a native dialog (zip or directory picker) and imports. */
    import(kind: 'zip' | 'directory'): Promise<PetPackInstallResult | null>
    remove(id: string): Promise<void>
    setActive(id: string): Promise<PetPackDetail | null>
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
    cancel(): Promise<AppUpdateState>
    retry(): Promise<AppUpdateState>
    defer(): Promise<AppUpdateState>
    reveal(): Promise<void>
    preferences(value: UpdatePreferences): Promise<AppUpdateState>
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
    getDefaultRoot(): Promise<string | null>
    getDefaultRoots(): Promise<string[]>
    ensureDefault(): Promise<AgentWorkspace>
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
    previewCleanup(options: SessionCleanupPreviewOptions): Promise<SessionCleanupPreview>
    executeCleanup(previewToken: string): Promise<SessionCleanupResult>
  }
  agent: {
    start(input: StartAgentSessionInput): Promise<{ sessionId: string; cwd: string }>
    prompt(input: PromptAgentInput): Promise<unknown>
    abort(sessionId: string): Promise<void>
    state(sessionId: string): Promise<AgentStateSnapshot | null>
    running(): Promise<string[]>
    command(sessionId: string, command: Record<string, unknown>): Promise<unknown>
    setPermissionMode(sessionId: string, mode: string): Promise<void>
    respondPermission(requestId: string, approved: boolean): Promise<void>
  }
  paste: {
    save(input: PasteSaveInput): Promise<PasteSaveResult>
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
    // Harness Control Plane
    listRuns(sessionId: string, scope?: 'session' | 'project'): Promise<HarnessRun[]>
    getRun(sessionId: string, runId: string): Promise<HarnessRun>
    getRunDetail(sessionId: string, runId: string): Promise<HarnessRunDetail>
    getRunTree(sessionId: string): Promise<HarnessRunTreeNode[]>
    compareRuns(sessionId: string, runIdA: string, runIdB: string): Promise<HarnessRunComparison>
    forkRun(
      sessionId: string,
      runId: string,
      options?: {
        mode?: 'fork' | 'rerun'
        fromEventId?: string
        fromCheckpointId?: string
        message?: string
      }
    ): Promise<{ forked: boolean; newSessionId: string | null; newRunId: string | null }>
    getBaseline(sessionId: string): Promise<HarnessBaseline | null>
    setBaseline(sessionId: string, runId: string): Promise<HarnessBaseline>
    getProjectStats(sessionId: string, range?: HarnessStatsRange): Promise<HarnessProjectStats>
    exportRun(
      sessionId: string,
      runId: string,
      format: 'json' | 'markdown'
    ): Promise<HarnessExportResult>
    exportDebugBundle(sessionId: string, runId?: string): Promise<HarnessExportResult>
    listArtifacts(sessionId: string, runId?: string): Promise<HarnessArtifact[]>
    getStoreSettings(): Promise<HarnessStoreSettings>
    updateStoreSettings(settings: HarnessStoreSettings): Promise<HarnessStoreSettings>
    getPolicy(): Promise<HarnessPolicySnapshot>
    setPolicy(config: HarnessPolicyConfig): Promise<HarnessPolicySnapshot>
    listCheckpoints(sessionId: string): Promise<HarnessCheckpoint[]>
    createCheckpoint(sessionId: string, includeGit?: boolean): Promise<HarnessCheckpoint>
    resumeCheckpoint(
      checkpointId: string,
      message?: string
    ): Promise<{ resumed: boolean; prompted: boolean }>
    forkCheckpoint(checkpointId: string): Promise<HarnessForkResult>
    retryLastRun(sessionId: string): Promise<{ retried: boolean; prompt: string | null }>
    evaluateRun(sessionId: string, runId: string): Promise<HarnessEvaluation>
    listEvaluations(sessionId: string): Promise<HarnessEvaluation[]>
  }
  orchestration: {
    list(): Promise<HarnessOrchestrationRun[]>
    get(orchestrationId: string): Promise<HarnessOrchestrationRun | null>
    create(input: {
      name?: string
      cwd: string
      strategy?: HarnessOrchestrationStrategy
      teamId?: string | null
      templateIds?: string[]
      maxConcurrentAgents?: number
      maxConcurrentRuns?: number
      budget?: { maxCost?: number | null; maxTokens?: number | null }
    }): Promise<HarnessOrchestrationRun>
    delete(orchestrationId: string): Promise<void>
    start(orchestrationId: string): Promise<HarnessOrchestrationRun>
    pause(orchestrationId: string, reason?: string): Promise<HarnessOrchestrationRun>
    resume(orchestrationId: string): Promise<HarnessOrchestrationRun>
    abort(orchestrationId: string): Promise<HarnessOrchestrationRun>
    snapshot(orchestrationId: string): Promise<HarnessOrchestrationSnapshot>
    listTemplates(): Promise<AgentTemplate[]>
    saveTemplate(template: {
      id?: string
      name: string
      role: string
      description?: string | null
      systemPrompt?: string | null
      provider?: string | null
      modelId?: string | null
      thinkingLevel?: string | null
      toolNames?: string[] | null
      skillIds?: string[]
      workspaceMode?: 'shared' | 'worktree'
      isReviewer?: boolean
    }): Promise<AgentTemplate>
    deleteTemplate(templateId: string): Promise<void>
    listTeams(): Promise<HarnessTeam[]>
    saveTeam(team: {
      id?: string
      name: string
      description?: string | null
      agentTemplateIds: string[]
    }): Promise<HarnessTeam>
    deleteTeam(teamId: string): Promise<void>
    listAgents(orchestrationId?: string): Promise<HarnessAgent[]>
    addAgent(input: {
      orchestrationId: string
      name: string
      role: string
      description?: string | null
      provider?: string | null
      modelId?: string | null
      thinkingLevel?: string | null
      toolNames?: string[] | null
      skillIds?: string[]
      workspaceMode?: 'shared' | 'worktree'
      isReviewer?: boolean
      templateId?: string | null
      budget?: HarnessOrchestrationBudget
    }): Promise<HarnessAgent>
    updateAgent(input: {
      agentId: string
      name?: string
      description?: string | null
      provider?: string | null
      modelId?: string | null
      thinkingLevel?: string | null
      toolNames?: string[] | null
      budget?: HarnessOrchestrationBudget
    }): Promise<HarnessAgent>
    deleteAgent(agentId: string): Promise<void>
    setAgentBudget(agentId: string, budget: HarnessOrchestrationBudget): Promise<HarnessAgent>
    listTasks(orchestrationId?: string): Promise<HarnessTask[]>
    createTask(input: {
      orchestrationId: string
      title: string
      description?: string | null
      priority?: HarnessTaskPriority
      assignedAgentId?: string | null
      parentTaskId?: string | null
      dependencies?: string[]
      inputArtifactIds?: string[]
      reviewRequired?: boolean
    }): Promise<HarnessTask>
    updateTask(input: {
      taskId: string
      title?: string
      description?: string | null
      priority?: HarnessTaskPriority
      assignedAgentId?: string | null
      parentTaskId?: string | null
      dependencies?: string[]
      inputArtifactIds?: string[]
      reviewRequired?: boolean
    }): Promise<HarnessTask>
    deleteTask(taskId: string): Promise<void>
    retryTask(taskId: string, agentId?: string | null): Promise<HarnessTask>
    skipTask(taskId: string): Promise<HarnessTask>
    reassignTask(taskId: string, agentId: string): Promise<HarnessTask>
    listHandoffs(orchestrationId?: string): Promise<AgentHandoff[]>
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
    generateCommitMessage(
      cwd: string,
      draft?: string,
      model?: { providerKey: string; modelId: string } | null
    ): Promise<GitCommitMessageResponse>
    commit(cwd: string, message: string): Promise<GitCommitResponse>
    history(cwd: string, limit?: number): Promise<GitCommitInfo[]>
    overview(cwd: string): Promise<GitRepositoryOverview>
    commitDetails(cwd: string, hash: string): Promise<GitCommitDetails>
    commitDiff(cwd: string, hash: string, filePath: string): Promise<GitCommitDiffResponse>
    action(input: GitActionRequest): Promise<GitActionResponse>
    fileHistory(cwd: string, filePath: string, limit?: number): Promise<GitCommitInfo[]>
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
  agentAura: {
    setActive(input: ScreenMotionActivePayload): Promise<void>
  }
  on(event: 'config-changed', listener: IpcEventListener): () => void
  on(event: 'ui-command', listener: (payload: UiCommandPayload) => void): () => void
  on(event: 'pi-environment-changed', listener: IpcEventListener): () => void
  on(
    event: 'environment-install-task',
    listener: (payload: EnvironmentInstallTask) => void
  ): () => void
  on(event: 'notification', listener: IpcEventListener): () => void
  on(event: 'agent-event', listener: IpcEventListener): () => void
  on(event: 'agent-permission', listener: IpcEventListener): () => void
  on(event: 'agent-running', listener: IpcEventListener): () => void
  on(event: 'sessions-changed', listener: (payload: { sessionId: string }) => void): () => void
  on(event: 'harness-event', listener: IpcEventListener): () => void
  on(event: 'updater-state', listener: IpcEventListener): () => void
  on(
    event: 'capability-progress',
    listener: (payload: CapabilityMutationProgress) => void
  ): () => void
  on(event: 'workspace-changed', listener: IpcEventListener): () => void
  on(event: 'architecture-selected', listener: IpcEventListener): () => void
  on(event: 'architecture-control', listener: IpcEventListener): () => void
}

declare global {
  interface Window {
    piSwitch?: PiSwitchAPI
    piSwitchOverlay?: PiSwitchOverlayAPI
    piSwitchPet?: PiSwitchPetAPI
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

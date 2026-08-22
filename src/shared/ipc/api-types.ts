/**
 * Typed IPC API surface. This is the shape of `window.piSwitch` exposed by the
 * preload bridge. The renderer imports these types and the PiSwitchAPI symbol;
 * it never calls `invoke("...")` with a raw string.
 */

import type { AppErrorPayload } from '../types/errors'
import type { ProviderProfile, ModelDefinition, ActiveModel, ApiKeySpec } from '../types/domain'
import type { ProtocolId } from '../constants/protocols'
import type {
  AgentStateSnapshot,
  FilePreview,
  FileTreeEntry,
  FileWriteResult,
  GitFileDiffResponse,
  GitStatusResponse,
  PromptAgentInput,
  ProjectContextAction,
  SessionContext,
  SessionContextAction,
  SessionDetail,
  SessionInfo,
  SessionProjectGroup,
  StartAgentSessionInput,
  WorktreeInfo
} from '../types/workspace'
import type { ToolPreset } from '../workspace/tool-presets'
import type { MascotStyle } from '../constants/mascot'

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
}

export interface NodeRuntimeInfo {
  nodeInstalled: boolean
  nodePath: string | null
  nodeVersion: string | null
  npmInstalled: boolean
  npmPath: string | null
  npmVersion: string | null
  /** True when both the system Node.js runtime and npm are executable. */
  ready: boolean
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
  origin?: 'local' | 'package'
  packageSource?: string
}

export interface PiPackageResources {
  skills: string[]
  prompts: string[]
  extensions: string[]
  themes: string[]
}

export interface PiPackageInfo {
  source: string
  name: string
  version: string | null
  description: string
  path: string | null
  installed: boolean
  available: boolean
  resources: PiPackageResources
}

export interface SkillMarketPackage {
  source: string
  name: string
  description: string
  installed: boolean
  installedVersion: string | null
}

export interface SkillMarketCollection {
  id: string
  kind: 'bundle' | 'guide'
  packages: SkillMarketPackage[]
}

export interface PiPackageActionResult {
  source: string
  ok: boolean
  skipped: boolean
  message: string
  stdout: string
  stderr: string
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
  config: ConfigStatus
  workspace: {
    sessionRoot: string
    sessionCount: number
    runningSessions: string[]
    piSdkLoaded: boolean
  }
}

export interface AppSettings {
  language: 'auto' | 'zh-CN' | 'en-US'
  theme: 'system' | 'dark' | 'light'
  density: 'comfortable' | 'compact'
  mascotStyle: MascotStyle
  mockMode: boolean
  manualCliPath: string | null
  manualConfigDir: string | null
  autoBackup: boolean
  backupRetention: number
  developerMode: boolean
  defaultToolPreset: ToolPreset
  restoreTabs: boolean
  autoOpenLastProject: boolean
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
  'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'

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
    list(): Promise<SkillInfo[]>
    packages(): Promise<PiPackageInfo[]>
    market(): Promise<SkillMarketCollection[]>
    installPackages(sources: string[]): Promise<PiPackageActionResult[]>
    removePackages(sources: string[]): Promise<PiPackageActionResult[]>
    removePackage(source: string): Promise<PiPackageActionResult>
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
  }
  window: {
    minimize(): Promise<void>
    maximizeToggle(): Promise<void>
    close(): Promise<void>
  }
  workspace: {
    listProjects(): Promise<SessionProjectGroup[]>
    pickDirectory(): Promise<string | null>
    allowRoot(root: string): Promise<void>
    projectContextMenu(
      projectKey: string,
      projectRoot: string,
      isPinned?: boolean,
      locale?: 'zh-CN' | 'en-US'
    ): Promise<ProjectContextAction | null>
    getPathForFile(file: unknown): string
  }
  sessions: {
    list(force?: boolean): Promise<SessionInfo[]>
    get(sessionId: string): Promise<SessionDetail>
    rename(sessionId: string, name: string): Promise<void>
    delete(sessionId: string): Promise<void>
    context(sessionId: string, leafId?: string | null): Promise<SessionContext>
    export(sessionId: string, format: 'html' | 'markdown'): Promise<string | null>
    viewFullHistory(sessionId: string): Promise<void>
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
    diff(cwd: string, filePath: string): Promise<GitFileDiffResponse>
  }
  worktrees: {
    list(cwd: string): Promise<WorktreeInfo[]>
    create(cwd: string, branch: string): Promise<{ path: string; branch: string }>
    remove(cwd: string, worktreePath: string, force?: boolean): Promise<void>
  }
  on(event: 'config-changed', listener: IpcEventListener): () => void
  on(event: 'pi-environment-changed', listener: IpcEventListener): () => void
  on(event: 'notification', listener: IpcEventListener): () => void
  on(event: 'agent-event', listener: IpcEventListener): () => void
  on(event: 'agent-running', listener: IpcEventListener): () => void
  on(event: 'updater-state', listener: IpcEventListener): () => void
}

declare global {
  interface Window {
    piSwitch?: PiSwitchAPI
  }
}

export type { ProviderProfile, ModelDefinition, ActiveModel, ApiKeySpec, ProtocolId }

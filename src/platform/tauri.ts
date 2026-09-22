/**
 * Tauri implementation of the `window.piSwitch` bridge.
 *
 * Invokes the Rust commands defined in `src-tauri/src/commands/` and maps
 * Tauri events back onto the `piSwitch.on(...)` contract. Every method that
 * the Rust shell has not wired up yet rejects with a typed
 * `SHELL_METHOD_PENDING` payload — the renderer's existing error pipeline
 * renders those like any other structured error.
 *
 * Only this module imports `@tauri-apps/api`. The Electron build never loads
 * it: `boot.ts` gates the dynamic import behind `isTauriHost()`, and the
 * compile-time `__TAURI_SHELL__` define lets Rollup drop it entirely from
 * Electron bundles.
 */

import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

import type { PiSwitchAPI } from '@shared/ipc/api-types'
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
  HarnessTeam,
  HarnessTool
} from '@shared/types/harness'
import type {
  AgentStateSnapshot,
  ProjectContextAction,
  PromptAgentInput,
  SessionContext,
  SessionContextAction,
  SessionDetail,
  SessionFolderContextAction,
  SessionInfo,
  StartAgentSessionInput
} from '@shared/types/workspace'
import { groupSessionsByProject } from '@shared/workspace/session-tree'
import type { AppErrorPayload } from '@shared/types/errors'
import type {
  PlatformRuntimeApi,
  PiSwitchTauriAPI,
  RuntimeLogEvent,
  RuntimePingResult,
  RuntimeRuntimeEvent,
  RuntimeStateEvent,
  RuntimeStatus,
  RuntimeVersionResult,
  SystemInfo
} from './types'
import { pendingMethod } from './detect'
import { rememberNativeDropPaths, resolveDroppedFilePath } from './dropped-path'

/** Tauri command names (snake_case, from src-tauri/src/commands/). */
const COMMANDS = {
  systemInfo: 'system_info',
  systemOpenPath: 'system_open_path',
  systemShowItem: 'system_show_item',
  windowMinimize: 'window_minimize',
  windowMaximizeToggle: 'window_maximize_toggle',
  windowClose: 'window_close',
  windowStartDrag: 'window_start_drag',
  runtimePing: 'runtime_ping',
  runtimeVersion: 'runtime_version',
  runtimeStatus: 'runtime_status',
  runtimeStart: 'runtime_start',
  runtimeStop: 'runtime_stop',
  runtimeRestart: 'runtime_restart',
  runtimeRequest: 'runtime_request',
  workspacePickDirectory: 'workspace_pick_directory',
  workspacePickWorkspaceSources: 'workspace_pick_workspace_sources',
  workspacePickWorkspaceFile: 'workspace_pick_workspace_file',
  workspaceSaveWorkspaceFile: 'workspace_save_workspace_file',
  workspaceAllowRoot: 'workspace_allow_root',
  workspaceGetPathForFile: 'workspace_get_path_for_file',
  workspaceGetActive: 'workspace_get_active',
  workspaceSync: 'workspace_sync',
  workspaceOpenFile: 'workspace_open_file',
  workspaceSave: 'workspace_save',
  workspaceSearch: 'workspace_search',
  workspaceOpenTerminal: 'workspace_open_terminal',
  workspaceRelocateFolder: 'workspace_relocate_folder',
  workspaceListRecent: 'workspace_list_recent',
  workspaceBindSession: 'workspace_bind_session',
  workspaceGetSessionBinding: 'workspace_get_session_binding',
  workspaceListSessionBindings: 'workspace_list_session_bindings',
  workspaceAssertCwd: 'workspace_assert_cwd',
  workspaceProjectContextMenu: 'workspace_project_context_menu',
  workspaceSessionFolderContextMenu: 'workspace_session_folder_context_menu',
  sessionsContextMenu: 'sessions_context_menu',
  filesList: 'files_list',
  filesRead: 'files_read',
  filesWrite: 'files_write',
  filesUpload: 'files_upload',
  gitStatus: 'git_status',
  gitStatusMany: 'git_status_many',
  gitDiff: 'git_diff',
  gitStage: 'git_stage',
  gitUnstage: 'git_unstage',
  gitGenerateCommitMessage: 'git_generate_commit_message',
  gitCommit: 'git_commit',
  gitHistory: 'git_history',
  gitOverview: 'git_overview',
  gitCommitDetails: 'git_commit_details',
  gitCommitDiff: 'git_commit_diff',
  gitAction: 'git_action',
  gitFileHistory: 'git_file_history',
  gitBranchContextMenu: 'git_branch_context_menu',
  worktreesList: 'worktrees_list',
  worktreesCreate: 'worktrees_create',
  worktreesRemove: 'worktrees_remove',
  piCopyInstallCommand: 'pi_copy_install_command',
  piOpenNodeDownload: 'pi_open_node_download',
  backupOpenFolder: 'backup_open_folder',
  logsOpenFolder: 'logs_open_folder',
  diagnosticsCopy: 'diagnostics_copy',
  diagnosticsExport: 'diagnostics_export',
  capabilitiesOpenHomepage: 'capabilities_open_homepage'
} as const

/** Event channel names — shared contract with the Rust host. */
const RUNTIME_STATE_EVENT = 'pi-harness:runtime:state'
const RUNTIME_EVENT_EVENT = 'pi-harness:runtime:event'
const RUNTIME_LOG_EVENT = 'pi-harness:runtime:log'

/**
 * `piSwitch.on(event, listener)` maps the renderer's short event names onto
 * the full `pi-harness:*` channel names used by the Electron main process.
 * Tauri events use the same full names, so one identity map suffices.
 */
const EVENT_CHANNELS: Record<string, string> = {
  'config-changed': 'pi-harness:event:config-changed',
  'pi-environment-changed': 'pi-harness:event:pi-env-changed',
  'environment-install-task': 'pi-harness:event:environment-install-task',
  notification: 'pi-harness:event:notification',
  'agent-event': 'pi-harness:agent:event',
  'agent-running': 'pi-harness:agent:running',
  'harness-event': 'pi-harness:harness:event',
  'updater-state': 'pi-harness:updater:state',
  'capability-progress': 'pi-harness:capabilities:mutation-progress',
  'workspace-changed': 'pi-harness:event:workspace-changed',
  'native-folder-drop': 'pi-harness:event:native-folder-drop'
}

/**
 * Subscribe to a Tauri event. Returns a synchronous unsubscribe function that
 * tolerates double-calls, matching the Electron preload's `() => void`
 * contract. Pending async unlisten chains are dropped after disposal.
 */
function subscribe(channel: string, listener: (payload: unknown) => void): () => void {
  let disposed = false
  let pendingUnlisten: Promise<UnlistenFn> | null = null

  pendingUnlisten = listen(channel, (event) => {
    if (!disposed) listener(event.payload)
  })

  return () => {
    if (disposed) return
    disposed = true
    const unlisten = pendingUnlisten
    pendingUnlisten = null
    if (unlisten) {
      unlisten
        .then((fn) => fn())
        .catch(() => {
          // Window is tearing down; the listener dies with it.
        })
    }
  }
}

/** Namespace whose methods are all still pending (not yet wired in Rust). */
function pendingNamespace<T extends object>(namespace: string): T {
  return new Proxy({} as T, {
    get(_target, method: string | symbol) {
      if (method === 'then' || typeof method !== 'string') {
        return undefined
      }
      return (..._args: unknown[]) => pendingMethod(namespace, method)
    }
  }) as T
}

/**
 * Domain RPC forwarder: the session/agent/harness methods run on the
 * Node sidecar (runtime/src/protocol/domain-methods.ts). `runtime_request`
 * auto-starts the runtime on demand (scenario B: the workspace opens, the
 * session list request itself boots the sidecar).
 */
function rpc<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  return invoke<T>(COMMANDS.runtimeRequest, { method, params })
}

/** Session APIs backed by the runtime sidecar (phase 2). */
function createSessionsApi(): PiSwitchAPI['sessions'] {
  return {
    list: (force?: boolean) =>
      rpc<{ sessions: SessionInfo[] }>('session.list', { force: force === true }).then(
        (result) => result.sessions
      ),
    get: (sessionId: string) => rpc<SessionDetail>('session.get', { sessionId }),
    rename: (sessionId: string, name: string) =>
      rpc<void>('session.rename', { sessionId, name }).then(() => undefined),
    delete: (sessionId: string) => rpc<void>('session.delete', { sessionId }).then(() => undefined),
    context: (sessionId: string, leafId?: string | null) =>
      rpc<SessionContext>('session.context', { sessionId, leafId: leafId ?? null }),
    viewFullHistory: (sessionId: string) =>
      rpc<SessionDetail>('session.viewFullHistory', { sessionId }),
    // Filesystem export plane is still Electron-only (Phase 5).
    export: () => pendingMethod('sessions', 'export'),
    exportProject: () => pendingMethod('sessions', 'exportProject'),
    contextMenu: (sessionId, isWorktree, isPinned, locale) =>
      invoke<SessionContextAction | null>(COMMANDS.sessionsContextMenu, {
        sessionId,
        isWorktree: isWorktree === true,
        isPinned: isPinned === true,
        locale: locale ?? 'en-US'
      })
  }
}

/** Agent APIs backed by the runtime sidecar (phase 2, scenario C). */
function createAgentApi(): PiSwitchAPI['agent'] {
  return {
    start: async (input: StartAgentSessionInput) => {
      if (input.cwd) {
        await invoke<string>(COMMANDS.workspaceAssertCwd, { cwd: input.cwd })
      }
      return rpc<{ sessionId: string; cwd: string }>('agent.start', { ...input })
    },
    prompt: (input: PromptAgentInput) => rpc<unknown>('agent.prompt', { ...input }),
    abort: (sessionId: string) => rpc<void>('agent.abort', { sessionId }).then(() => undefined),
    state: (sessionId: string) => rpc<AgentStateSnapshot | null>('agent.state', { sessionId }),
    running: () => rpc<{ ids: string[] }>('agent.running').then((result) => result.ids),
    command: (sessionId: string, command: Record<string, unknown>) =>
      rpc<unknown>('agent.command', { sessionId, command })
  }
}

/** Harness APIs backed by the runtime sidecar (phase 2). */
function createHarnessApi(): PiSwitchAPI['harness'] {
  return {
    state: (sessionId: string) => rpc<HarnessState | null>('harness.getState', { sessionId }),
    tools: (sessionId: string) => rpc<HarnessTool[]>('harness.getTools', { sessionId }),
    setTools: (sessionId: string, toolNames: string[]) =>
      rpc<void>('harness.setTools', { sessionId, toolNames }).then(() => undefined),
    setModel: (sessionId: string, provider: string, modelId: string) =>
      rpc<void>('harness.setModel', { sessionId, provider, modelId }).then(() => undefined),
    setThinkingLevel: (sessionId: string, level: string) =>
      rpc<void>('harness.setThinkingLevel', { sessionId, level }).then(() => undefined),
    compact: (sessionId: string, instructions?: string) =>
      rpc<HarnessCompactionResult | unknown>('harness.compact', { sessionId, instructions }),
    abortCompaction: (sessionId: string) =>
      rpc<void>('harness.abortCompaction', { sessionId }).then(() => undefined),
    setAutoCompaction: (sessionId: string, enabled: boolean) =>
      rpc<void>('harness.setAutoCompaction', { sessionId, enabled }).then(() => undefined),
    steer: (sessionId: string, message: string) =>
      rpc<void>('harness.steer', { sessionId, message }).then(() => undefined),
    followUp: (sessionId: string, message: string) =>
      rpc<void>('harness.followUp', { sessionId, message }).then(() => undefined),
    fork: (sessionId: string, entryId: string) =>
      rpc<HarnessForkResult>('harness.fork', { sessionId, entryId }),
    navigateTree: (sessionId: string, entryId: string) =>
      rpc<unknown>('harness.navigateTree', { sessionId, targetId: entryId }),
    session: (sessionId: string) => rpc<HarnessSessionInfo>('harness.getSession', { sessionId }),
    stats: (sessionId: string) => rpc<HarnessStats>('harness.getStats', { sessionId }),
    timeline: (sessionId: string) =>
      rpc<{ events: HarnessEvent[] }>('harness.getTimeline', { sessionId }).then(
        (result) => result.events
      ),
    listRuns: (sessionId: string, scope?: 'session' | 'project') =>
      rpc<HarnessRun[]>('harness.listRuns', { sessionId, scope }),
    getRun: (sessionId: string, runId: string) =>
      rpc<HarnessRun>('harness.getRun', { sessionId, runId }),
    getRunDetail: (sessionId: string, runId: string) =>
      rpc<HarnessRunDetail>('harness.getRunDetail', { sessionId, runId }),
    getRunTree: (sessionId: string) =>
      rpc<HarnessRunTreeNode[]>('harness.getRunTree', { sessionId }),
    compareRuns: (sessionId: string, runIdA: string, runIdB: string) =>
      rpc<HarnessRunComparison>('harness.compareRuns', { sessionId, runIdA, runIdB }),
    forkRun: (sessionId, runId, options) =>
      rpc<{ forked: boolean; newSessionId: string | null; newRunId: string | null }>(
        'harness.forkRun',
        { sessionId, runId, ...options }
      ),
    getBaseline: (sessionId: string) =>
      rpc<HarnessBaseline | null>('harness.getBaseline', { sessionId }),
    setBaseline: (sessionId: string, runId: string) =>
      rpc<HarnessBaseline>('harness.setBaseline', { sessionId, runId }),
    getProjectStats: (sessionId: string, range?: HarnessStatsRange) =>
      rpc<HarnessProjectStats>('harness.getProjectStats', { sessionId, range }),
    exportRun: (sessionId: string, runId: string, format: 'json' | 'markdown') =>
      rpc<HarnessExportResult>('harness.exportRun', { sessionId, runId, format }),
    exportDebugBundle: (sessionId: string, runId?: string) =>
      rpc<HarnessExportResult>('harness.exportDebugBundle', { sessionId, runId }),
    listArtifacts: (sessionId: string, runId?: string) =>
      rpc<HarnessArtifact[]>('harness.listArtifacts', { sessionId, runId }),
    getStoreSettings: () => rpc<HarnessStoreSettings>('harness.getStoreSettings'),
    updateStoreSettings: (settings: HarnessStoreSettings) =>
      rpc<HarnessStoreSettings>('harness.updateStoreSettings', { ...settings }),
    getPolicy: () => rpc<HarnessPolicySnapshot>('harness.getPolicy'),
    setPolicy: (config: HarnessPolicyConfig) =>
      rpc<HarnessPolicySnapshot>('harness.setPolicy', { config }),
    listCheckpoints: (sessionId: string) =>
      rpc<HarnessCheckpoint[]>('harness.listCheckpoints', { sessionId }),
    createCheckpoint: (sessionId: string, includeGit?: boolean) =>
      rpc<HarnessCheckpoint>('harness.createCheckpoint', { sessionId, includeGit }),
    resumeCheckpoint: (checkpointId: string, message?: string) =>
      rpc<{ resumed: boolean; prompted: boolean }>('harness.resumeCheckpoint', {
        checkpointId,
        message
      }),
    forkCheckpoint: (checkpointId: string) =>
      rpc<HarnessForkResult>('harness.forkCheckpoint', { checkpointId }),
    retryLastRun: (sessionId: string) =>
      rpc<{ retried: boolean; prompt: string | null }>('harness.retryLastRun', { sessionId }),
    evaluateRun: (sessionId: string, runId: string) =>
      rpc<HarnessEvaluation>('harness.evaluateRun', { sessionId, runId }),
    listEvaluations: (sessionId: string) =>
      rpc<HarnessEvaluation[]>('harness.listEvaluations', { sessionId })
  }
}

function createOrchestrationApi(): PiSwitchAPI['orchestration'] {
  return {
    list: () => rpc<HarnessOrchestrationRun[]>('orchestration.list'),
    get: (orchestrationId: string) =>
      rpc<HarnessOrchestrationRun | null>('orchestration.get', { orchestrationId }),
    create: (input) => rpc<HarnessOrchestrationRun>('orchestration.create', { ...input }),
    delete: (orchestrationId: string) =>
      rpc<void>('orchestration.delete', { orchestrationId }).then(() => undefined),
    start: (orchestrationId: string) =>
      rpc<HarnessOrchestrationRun>('orchestration.start', { orchestrationId }),
    pause: (orchestrationId: string, reason?: string) =>
      rpc<HarnessOrchestrationRun>('orchestration.pause', { orchestrationId, reason }),
    resume: (orchestrationId: string) =>
      rpc<HarnessOrchestrationRun>('orchestration.resume', { orchestrationId }),
    abort: (orchestrationId: string) =>
      rpc<HarnessOrchestrationRun>('orchestration.abort', { orchestrationId }),
    snapshot: (orchestrationId: string) =>
      rpc<HarnessOrchestrationSnapshot>('orchestration.snapshot', { orchestrationId }),
    listTemplates: () => rpc<AgentTemplate[]>('orchestration.listTemplates'),
    saveTemplate: (template) => rpc<AgentTemplate>('orchestration.saveTemplate', { ...template }),
    deleteTemplate: (templateId: string) =>
      rpc<void>('orchestration.deleteTemplate', { templateId }).then(() => undefined),
    listTeams: () => rpc<HarnessTeam[]>('orchestration.listTeams'),
    saveTeam: (team) => rpc<HarnessTeam>('orchestration.saveTeam', { ...team }),
    deleteTeam: (teamId: string) =>
      rpc<void>('orchestration.deleteTeam', { teamId }).then(() => undefined),
    listAgents: (orchestrationId?: string) =>
      rpc<HarnessAgent[]>('orchestration.listAgents', { orchestrationId }),
    addAgent: (input) => rpc<HarnessAgent>('orchestration.addAgent', { ...input }),
    updateAgent: (input) => rpc<HarnessAgent>('orchestration.updateAgent', { ...input }),
    deleteAgent: (agentId: string) =>
      rpc<void>('orchestration.deleteAgent', { agentId }).then(() => undefined),
    setAgentBudget: (agentId: string, budget: HarnessOrchestrationBudget) =>
      rpc<HarnessAgent>('orchestration.setAgentBudget', { agentId, budget }),
    listTasks: (orchestrationId?: string) =>
      rpc<HarnessTask[]>('orchestration.listTasks', { orchestrationId }),
    createTask: (input) => rpc<HarnessTask>('orchestration.createTask', { ...input }),
    updateTask: (input) => rpc<HarnessTask>('orchestration.updateTask', { ...input }),
    deleteTask: (taskId: string) =>
      rpc<void>('orchestration.deleteTask', { taskId }).then(() => undefined),
    retryTask: (taskId: string, agentId?: string | null) =>
      rpc<HarnessTask>('orchestration.retryTask', { taskId, agentId }),
    skipTask: (taskId: string) => rpc<HarnessTask>('orchestration.skipTask', { taskId }),
    reassignTask: (taskId: string, agentId: string) =>
      rpc<HarnessTask>('orchestration.reassignTask', { taskId, agentId }),
    listHandoffs: (orchestrationId?: string) =>
      rpc<AgentHandoff[]>('orchestration.listHandoffs', { orchestrationId })
  }
}

const runtime: PlatformRuntimeApi = {
  ping: () => invoke<RuntimePingResult>(COMMANDS.runtimePing),
  version: () => invoke<RuntimeVersionResult>(COMMANDS.runtimeVersion),
  status: () => invoke<RuntimeStatus>(COMMANDS.runtimeStatus),
  start: () => invoke<RuntimeStatus>(COMMANDS.runtimeStart),
  stop: () => invoke<RuntimeStatus>(COMMANDS.runtimeStop),
  restart: () => invoke<RuntimeStatus>(COMMANDS.runtimeRestart),
  onState: (listener: (payload: RuntimeStateEvent) => void) =>
    subscribe(RUNTIME_STATE_EVENT, (payload) => listener(payload as RuntimeStateEvent)),
  onEvent: (listener: (payload: RuntimeRuntimeEvent) => void) =>
    subscribe(RUNTIME_EVENT_EVENT, (payload) => listener(payload as RuntimeRuntimeEvent)),
  onLog: (listener: (payload: RuntimeLogEvent) => void) =>
    subscribe(RUNTIME_LOG_EVENT, (payload) => listener(payload as RuntimeLogEvent))
}

/**
 * Install the drag-region shim. The renderer's titlebar relies on
 * `-webkit-app-region: drag`, which WKWebView ignores. Tauri's own
 * `data-tauri-drag-region` attribute is not present in the existing markup,
 * so we listen for mousedowns on `.drag-region` elements (excluding
 * `.no-drag`) and forward them to the Rust `window_start_drag` command.
 */
function installDragRegionShim(): void {
  const isDragRegion = (element: Element | null): boolean => {
    for (let node = element; node; node = node.parentElement) {
      if (node.classList.contains('no-drag')) return false
      if (node.classList.contains('drag-region')) return true
    }
    return false
  }

  document.addEventListener('mousedown', (event) => {
    // Left button only; let text selection and context menus through.
    if (event.button !== 0) return
    if (!isDragRegion(event.target as Element | null)) return
    invoke(COMMANDS.windowStartDrag).catch(() => {
      // Drag start refused (e.g. window already being moved) — ignore.
    })
  })
}

function createWorkspaceApi(): PiSwitchAPI['workspace'] {
  return {
    listProjects: async () => {
      const sessions = await rpc<{ sessions: SessionInfo[] }>('session.list', { force: false }).then(
        (result) => result.sessions
      )
      return groupSessionsByProject(sessions)
    },
    pickDirectory: () => invoke<string | null>(COMMANDS.workspacePickDirectory),
    pickWorkspaceSources: () => invoke<string[]>(COMMANDS.workspacePickWorkspaceSources),
    pickWorkspaceFile: () => invoke<string | null>(COMMANDS.workspacePickWorkspaceFile),
    saveWorkspaceFile: () => invoke<string | null>(COMMANDS.workspaceSaveWorkspaceFile),
    allowRoot: (root) => invoke<void>(COMMANDS.workspaceAllowRoot, { root }),
    projectContextMenu: (projectKey, projectRoot, isPinned, locale) =>
      invoke<ProjectContextAction | null>(COMMANDS.workspaceProjectContextMenu, {
        projectKey,
        projectRoot,
        isPinned: isPinned === true,
        locale: locale ?? 'en-US'
      }),
    sessionFolderContextMenu: (locale) =>
      invoke<SessionFolderContextAction | null>(COMMANDS.workspaceSessionFolderContextMenu, {
        locale: locale ?? 'en-US'
      }),
    getPathForFile: (file) => {
      const path = resolveDroppedFilePath(file)
      if (!path) {
        return Promise.reject({
          code: 'VALIDATION_ERROR',
          message: 'Dropped file path is unavailable',
          userMessage: '无法解析拖放路径，请改用选择文件夹。',
          recoverable: true
        } satisfies AppErrorPayload)
      }
      return invoke<string>(COMMANDS.workspaceGetPathForFile, { file: path })
    },
    getActive: () => invoke(COMMANDS.workspaceGetActive),
    sync: (input) => invoke(COMMANDS.workspaceSync, { input }),
    openWorkspaceFile: (path) => invoke(COMMANDS.workspaceOpenFile, { path }),
    save: (input) => invoke(COMMANDS.workspaceSave, { input }),
    search: (query, scope, folderId) =>
      invoke(COMMANDS.workspaceSearch, { query, scope, folderId }),
    openInTerminal: (directory) => invoke(COMMANDS.workspaceOpenTerminal, { directory }),
    relocateFolder: (folderId, path) =>
      invoke(COMMANDS.workspaceRelocateFolder, { folderId, path }),
    listRecent: () => invoke(COMMANDS.workspaceListRecent),
    bindSession: (sessionId, workspaceId, folders, mainFolderId) =>
      invoke(COMMANDS.workspaceBindSession, {
        input: { sessionId, workspaceId, folders, mainFolderId }
      }),
    getSessionBinding: (sessionId) =>
      invoke(COMMANDS.workspaceGetSessionBinding, { sessionId }),
    listSessionBindings: () => invoke(COMMANDS.workspaceListSessionBindings)
  }
}

function createFilesApi(): PiSwitchAPI['files'] {
  return {
    list: (directory) => invoke(COMMANDS.filesList, { directory }),
    read: (path) => invoke(COMMANDS.filesRead, { path }),
    write: (path, text, expectedRevision, overwrite) =>
      invoke(COMMANDS.filesWrite, { path, text, expectedRevision, overwrite }),
    upload: (directory, fileName, dataBase64, overwrite) =>
      invoke(COMMANDS.filesUpload, { directory, fileName, dataBase64, overwrite })
  }
}

function createGitApi(): PiSwitchAPI['git'] {
  return {
    status: (cwd) => invoke(COMMANDS.gitStatus, { cwd }),
    statusMany: (cwds) => invoke(COMMANDS.gitStatusMany, { cwds }),
    diff: (cwd, filePath) => invoke(COMMANDS.gitDiff, { cwd, filePath }),
    stage: (cwd, filePaths) => invoke(COMMANDS.gitStage, { cwd, filePaths }),
    unstage: (cwd, filePaths) => invoke(COMMANDS.gitUnstage, { cwd, filePaths }),
    generateCommitMessage: (cwd, draft, model) =>
      invoke(COMMANDS.gitGenerateCommitMessage, { cwd, draft, model }),
    commit: (cwd, message) => invoke(COMMANDS.gitCommit, { cwd, message }),
    history: (cwd, limit) => invoke(COMMANDS.gitHistory, { cwd, limit }),
    overview: (cwd) => invoke(COMMANDS.gitOverview, { cwd }),
    commitDetails: (cwd, hash) => invoke(COMMANDS.gitCommitDetails, { cwd, hash }),
    commitDiff: (cwd, hash, filePath) => invoke(COMMANDS.gitCommitDiff, { cwd, hash, filePath }),
    action: (input) => invoke(COMMANDS.gitAction, { input }),
    fileHistory: (cwd, filePath, limit) =>
      invoke(COMMANDS.gitFileHistory, { cwd, filePath, limit }),
    branchContextMenu: (input) => invoke(COMMANDS.gitBranchContextMenu, { input })
  }
}

function createPiApi(): PiSwitchAPI['pi'] {
  return {
    detect: () => rpc('pi.detect'),
    getVersion: () => rpc('pi.getVersion'),
    runHelp: () => rpc('pi.runHelp'),
    checkLatest: () => rpc('pi.checkLatest'),
    install: () => rpc('pi.install'),
    bootstrap: () => rpc('pi.bootstrap'),
    installNode: () => rpc('pi.installNode'),
    reinstall: () => rpc('pi.reinstall'),
    getInstallTask: () => rpc('pi.getInstallTask'),
    cancelInstall: () => rpc('pi.cancelInstall'),
    update: (force?: boolean) => rpc('pi.update', { force: force === true }),
    copyInstallCommand: () => invoke(COMMANDS.piCopyInstallCommand),
    openNodeDownload: () => invoke(COMMANDS.piOpenNodeDownload)
  }
}

function createProvidersApi(): PiSwitchAPI['providers'] {
  return {
    list: () => rpc('providers.list'),
    get: (key) => rpc('providers.get', { key }),
    create: (form, options) => rpc('providers.create', { form, options }),
    update: (key, form, options) => rpc('providers.update', { key, form, options }),
    delete: (key, options) => rpc<void>('providers.delete', { key, options }).then(() => undefined),
    duplicate: (key, options) => rpc('providers.duplicate', { key, options }),
    setEnabled: (key, enabled) => rpc('providers.setEnabled', { key, enabled }),
    testConnection: (input) => rpc('providers.testConnection', { input }),
    discoverModels: (input) => rpc('providers.discoverModels', { input })
  }
}

function createModelsApi(): PiSwitchAPI['models'] {
  return {
    list: () => rpc('models.list'),
    create: (form, options) => rpc('models.create', { form, options }),
    update: (id, form, options) => rpc('models.update', { id, form, options }),
    delete: (id, options) => rpc<void>('models.delete', { id, options }).then(() => undefined),
    setActive: (input, options) => rpc('models.setActive', { input, options }),
    getActive: () => rpc('models.getActive')
  }
}

function createConfigApi(): PiSwitchAPI['config'] {
  return {
    read: () => rpc('config.read'),
    readRaw: (file) => rpc('config.readRaw', { file }),
    writeRaw: (file, content, options) =>
      rpc<void>('config.writeRaw', { file, content, options }).then(() => undefined),
    readSettings: () => rpc('config.readSettings'),
    reload: () => rpc('config.reload'),
    getStatus: () => rpc('config.getStatus'),
    conflictSnapshot: (file) => rpc('config.conflictSnapshot', { file })
  }
}

function createSkillsApi(): PiSwitchAPI['skills'] {
  return {
    list: (projectRoot) => rpc('skills.list', { projectRoot }),
    packages: (projectRoot) => rpc('skills.packages', { projectRoot }),
    market: (projectRoot) => rpc('skills.market', { projectRoot }),
    installBuiltinSkills: (target) => rpc('skills.installBuiltinSkills', { target }),
    updateBuiltinSkills: (target) => rpc('skills.updateBuiltinSkills', { target }),
    uninstallBuiltinSkills: (target) => rpc('skills.uninstallBuiltinSkills', { target }),
    installPackages: (targets) => rpc('skills.installPackages', { targets }),
    searchRegistry: (input) => rpc('skills.searchRegistry', { input }),
    getRegistryPackageDetail: (name, refresh) =>
      rpc('skills.getRegistryPackageDetail', { name, refresh }),
    checkPackageUpdates: (projectRoot) => rpc('skills.checkPackageUpdates', { projectRoot }),
    updatePackage: (target) => rpc('skills.updatePackage', { target }),
    updateAllPackages: (projectRoot) => rpc('skills.updateAllPackages', { projectRoot }),
    repairPackage: (target) => rpc('skills.repairPackage', { target }),
    registerPackage: (target) => rpc('skills.registerPackage', { target }),
    removePackages: (targets) => rpc('skills.removePackages', { targets }),
    removePackage: (target) => rpc('skills.removePackage', { target }),
    deleteOrphanPackage: (target) => rpc('skills.deleteOrphanPackage', { target }),
    cleanupPlan: (projectRoot) => rpc('skills.cleanupPlan', { projectRoot }),
    cleanupThirdParty: (projectRoot) => rpc('skills.cleanupThirdParty', { projectRoot }),
    repairPermissions: (projectRoot) => rpc('skills.repairPermissions', { projectRoot }),
    read: (path) => rpc('skills.read', { path }),
    create: (form) => rpc('skills.create', { form }),
    update: (form) => rpc('skills.update', { form }),
    import: (input) => rpc('skills.import', { input }),
    validate: (form) => rpc('skills.validate', { form }),
    delete: (path) => rpc<void>('skills.delete', { path }).then(() => undefined),
    refresh: () => rpc('skills.refresh')
  }
}

function createCapabilitiesApi(): PiSwitchAPI['capabilities'] {
  return {
    list: () => rpc('capabilities.list'),
    openHomepage: (skillId) => invoke(COMMANDS.capabilitiesOpenHomepage, { skillId }),
    installSkill: (skillId) => rpc('capabilities.installSkill', { skillId }),
    updateSkill: (skillId) => rpc('capabilities.updateSkill', { skillId }),
    uninstallSkill: (skillId) => rpc('capabilities.uninstallSkill', { skillId }),
    setSkillEnabled: (skillId, enabled) =>
      rpc('capabilities.setSkillEnabled', { skillId, enabled })
  }
}

function createBackupApi(): PiSwitchAPI['backup'] {
  return {
    list: () => rpc('backup.list'),
    create: (reason) => rpc('backup.create', { reason }),
    restore: (id) => rpc<void>('backup.restore', { id }).then(() => undefined),
    delete: (id) => rpc<void>('backup.delete', { id }).then(() => undefined),
    pruneToRetention: (retention) => rpc('backup.pruneToRetention', { retention }),
    openFolder: () => invoke(COMMANDS.backupOpenFolder).then(() => undefined)
  }
}

function createSettingsApi(): PiSwitchAPI['settings'] {
  return {
    get: () => rpc('settings.get'),
    set: (patch) => rpc('settings.set', { patch }),
    unlockMascot: (answer) => rpc('settings.unlockMascot', { answer }),
    getUiState: () => rpc('settings.getUiState'),
    setUiState: (state) => rpc<void>('settings.setUiState', { state }).then(() => undefined)
  }
}

function createDiagnosticsApi(): PiSwitchAPI['diagnostics'] {
  return {
    get: () => rpc('diagnostics.get'),
    copy: () => invoke(COMMANDS.diagnosticsCopy),
    export: () => invoke(COMMANDS.diagnosticsExport)
  }
}

function createLogsApi(): PiSwitchAPI['logs'] {
  return {
    read: () => rpc('logs.read'),
    openFolder: () => invoke(COMMANDS.logsOpenFolder)
  }
}

function createWorktreesApi(): PiSwitchAPI['worktrees'] {
  return {
    list: (cwd) => invoke(COMMANDS.worktreesList, { cwd }),
    create: (cwd, branch) => invoke(COMMANDS.worktreesCreate, { cwd, branch }),
    remove: (cwd, worktreePath, force) =>
      invoke(COMMANDS.worktreesRemove, { cwd, worktreePath, force })
  }
}

/**
 * Build the complete Tauri `window.piSwitch` implementation.
 */
export function createTauriBridge(): PiSwitchTauriAPI {
  const bridge = {
    system: {
      info: () => invoke<SystemInfo>(COMMANDS.systemInfo),
      openPath: (path: string) => invoke<void>(COMMANDS.systemOpenPath, { path }),
      showItem: (path: string) => invoke<void>(COMMANDS.systemShowItem, { path })
    },
    pi: createPiApi(),
    providers: createProvidersApi(),
    models: createModelsApi(),
    config: createConfigApi(),
    skills: createSkillsApi(),
    capabilities: createCapabilitiesApi(),
    backup: createBackupApi(),
    settings: createSettingsApi(),
    diagnostics: createDiagnosticsApi(),
    logs: createLogsApi(),
    updater: pendingNamespace<PiSwitchAPI['updater']>('updater'),
    window: {
      minimize: () => invoke<void>(COMMANDS.windowMinimize),
      maximizeToggle: () => invoke<void>(COMMANDS.windowMaximizeToggle),
      close: () => invoke<void>(COMMANDS.windowClose)
    },
    workspace: createWorkspaceApi(),
    sessions: createSessionsApi(),
    agent: createAgentApi(),
    harness: createHarnessApi(),
    orchestration: createOrchestrationApi(),
    files: createFilesApi(),
    git: createGitApi(),
    worktrees: createWorktreesApi(),
    agentAura: pendingNamespace<PiSwitchAPI['agentAura']>('agentAura'),
    runtime,
    on: ((event: string, listener: (payload: unknown) => void) => {
      const channel = EVENT_CHANNELS[event] ?? `pi-harness:event:${event}`
      return subscribe(channel, listener)
    }) as PiSwitchAPI['on']
  }

  installDragRegionShim()
  installNativeDropCache()
  return bridge as PiSwitchTauriAPI
}

/**
 * Cache Tauri native drag-drop paths so `getPathForFile` can resolve a
 * WKWebView `File` that only has `name` (no filesystem path).
 */
function installNativeDropCache(): void {
  listen('tauri://drag-drop', (event) => {
    const payload = event.payload as { paths?: unknown }
    const paths = Array.isArray(payload?.paths)
      ? payload.paths.filter((path): path is string => typeof path === 'string')
      : []
    if (paths.length) rememberNativeDropPaths(paths)
  }).catch(() => {
    /* no webview in unit tests */
  })
}

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
  HarnessCompactionResult,
  HarnessEvent,
  HarnessForkResult,
  HarnessSessionInfo,
  HarnessState,
  HarnessStats,
  HarnessTool
} from '@shared/types/harness'
import type {
  AgentStateSnapshot,
  PromptAgentInput,
  SessionContext,
  SessionDetail,
  SessionInfo,
  StartAgentSessionInput
} from '@shared/types/workspace'
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
  runtimeRequest: 'runtime_request'
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
  'workspace-changed': 'pi-harness:event:workspace-changed'
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
    // Phase 3 (filesystem/export plane lives in the Rust host):
    export: () => pendingMethod('sessions', 'export'),
    exportProject: () => pendingMethod('sessions', 'exportProject'),
    contextMenu: () => pendingMethod('sessions', 'contextMenu')
  }
}

/** Agent APIs backed by the runtime sidecar (phase 2, scenario C). */
function createAgentApi(): PiSwitchAPI['agent'] {
  return {
    start: (input: StartAgentSessionInput) =>
      rpc<{ sessionId: string; cwd: string }>('agent.start', { ...input }),
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
  const pending = pendingMethod
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
    // Harness Control Plane — phase 3 (store/policy/checkpoint services
    // stay on the Electron main process until they migrate):
    listRuns: (_sessionId: string) => pending('harness', 'listRuns'),
    getRun: (_sessionId: string) => pending('harness', 'getRun'),
    getRunDetail: (_sessionId: string) => pending('harness', 'getRunDetail'),
    getRunTree: (_sessionId: string) => pending('harness', 'getRunTree'),
    compareRuns: (_sessionId: string) => pending('harness', 'compareRuns'),
    forkRun: (_sessionId: string) => pending('harness', 'forkRun'),
    getBaseline: (_sessionId: string) => pending('harness', 'getBaseline'),
    setBaseline: (_sessionId: string) => pending('harness', 'setBaseline'),
    getProjectStats: (_sessionId: string) => pending('harness', 'getProjectStats'),
    exportRun: (_sessionId: string) => pending('harness', 'exportRun'),
    exportDebugBundle: (_sessionId: string) => pending('harness', 'exportDebugBundle'),
    listArtifacts: (_sessionId: string) => pending('harness', 'listArtifacts'),
    getStoreSettings: () => pending('harness', 'getStoreSettings'),
    updateStoreSettings: () => pending('harness', 'updateStoreSettings'),
    getPolicy: () => pending('harness', 'getPolicy'),
    setPolicy: () => pending('harness', 'setPolicy'),
    listCheckpoints: (_sessionId: string) => pending('harness', 'listCheckpoints'),
    createCheckpoint: (_sessionId: string) => pending('harness', 'createCheckpoint'),
    resumeCheckpoint: () => pending('harness', 'resumeCheckpoint'),
    forkCheckpoint: () => pending('harness', 'forkCheckpoint'),
    retryLastRun: (_sessionId: string) => pending('harness', 'retryLastRun'),
    evaluateRun: (_sessionId: string) => pending('harness', 'evaluateRun'),
    listEvaluations: (_sessionId: string) => pending('harness', 'listEvaluations')
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
    pi: pendingNamespace<PiSwitchAPI['pi']>('pi'),
    providers: pendingNamespace<PiSwitchAPI['providers']>('providers'),
    models: pendingNamespace<PiSwitchAPI['models']>('models'),
    config: pendingNamespace<PiSwitchAPI['config']>('config'),
    skills: pendingNamespace<PiSwitchAPI['skills']>('skills'),
    capabilities: pendingNamespace<PiSwitchAPI['capabilities']>('capabilities'),
    backup: pendingNamespace<PiSwitchAPI['backup']>('backup'),
    settings: pendingNamespace<PiSwitchAPI['settings']>('settings'),
    diagnostics: pendingNamespace<PiSwitchAPI['diagnostics']>('diagnostics'),
    logs: pendingNamespace<PiSwitchAPI['logs']>('logs'),
    updater: pendingNamespace<PiSwitchAPI['updater']>('updater'),
    window: {
      minimize: () => invoke<void>(COMMANDS.windowMinimize),
      maximizeToggle: () => invoke<void>(COMMANDS.windowMaximizeToggle),
      close: () => invoke<void>(COMMANDS.windowClose)
    },
    workspace: pendingNamespace<PiSwitchAPI['workspace']>('workspace'),
    sessions: createSessionsApi(),
    agent: createAgentApi(),
    harness: createHarnessApi(),
    orchestration: pendingNamespace<PiSwitchAPI['orchestration']>('orchestration'),
    files: pendingNamespace<PiSwitchAPI['files']>('files'),
    git: pendingNamespace<PiSwitchAPI['git']>('git'),
    worktrees: pendingNamespace<PiSwitchAPI['worktrees']>('worktrees'),
    agentAura: pendingNamespace<PiSwitchAPI['agentAura']>('agentAura'),
    runtime,
    on: ((event: string, listener: (payload: unknown) => void) => {
      const channel = EVENT_CHANNELS[event] ?? `pi-harness:event:${event}`
      return subscribe(channel, listener)
    }) as PiSwitchAPI['on']
  }

  installDragRegionShim()
  return bridge as PiSwitchTauriAPI
}

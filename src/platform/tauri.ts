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
  runtimeRestart: 'runtime_restart'
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
    sessions: pendingNamespace<PiSwitchAPI['sessions']>('sessions'),
    agent: pendingNamespace<PiSwitchAPI['agent']>('agent'),
    harness: pendingNamespace<PiSwitchAPI['harness']>('harness'),
    orchestration: pendingNamespace<PiSwitchAPI['orchestration']>('orchestration'),
    files: pendingNamespace<PiSwitchAPI['files']>('files'),
    git: pendingNamespace<PiSwitchAPI['git']>('git'),
    worktrees: pendingNamespace<PiSwitchAPI['worktrees']>('worktrees'),
    aiMotion: pendingNamespace<PiSwitchAPI['aiMotion']>('aiMotion'),
    runtime,
    on: ((event: string, listener: (payload: unknown) => void) => {
      const channel = EVENT_CHANNELS[event] ?? `pi-harness:event:${event}`
      return subscribe(channel, listener)
    }) as PiSwitchAPI['on']
  }

  installDragRegionShim()
  return bridge as PiSwitchTauriAPI
}

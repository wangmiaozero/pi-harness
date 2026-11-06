import { reactive, ref } from 'vue'
import type { NodeRuntimeInfo } from '@shared/ipc/api-types'

export type StartupPhase = 'settings' | 'services' | 'ready'

export const STARTUP_MINIMUM_VISIBLE_MS = 5000

/** Cold process launch only. A later window in the same process passes startup=0. */
export function shouldPlayStartupAnimation(search: string): boolean {
  const query = search.startsWith('?') ? search.slice(1) : search
  return new URLSearchParams(query).get('startup') !== '0'
}

export const startupPhase = ref<StartupPhase>('settings')
export const startupAnimationVisible = ref(
  shouldPlayStartupAnimation(typeof location === 'undefined' ? '' : location.search)
)

export type StartupCheckState = 'checking' | 'healthy' | 'warning' | 'error'

export const startupChecks = reactive({
  node: { state: 'checking' as StartupCheckState, detail: '检测中…' },
  npm: { state: 'checking' as StartupCheckState, detail: '检测中…' },
  pi: { state: 'checking' as StartupCheckState, detail: '检测中…' },
  config: { state: 'checking' as StartupCheckState, detail: '检测中…' }
})

export function runtimeStartupChecks(runtime: NodeRuntimeInfo | null): {
  node: { state: StartupCheckState; detail: string }
  npm: { state: StartupCheckState; detail: string }
} {
  if (!runtime) {
    return {
      node: { state: 'error', detail: '检测失败' },
      npm: { state: 'error', detail: '检测失败' }
    }
  }
  return {
    node: runtime.nodeSupported
      ? { state: 'healthy', detail: `已就绪 · ${runtime.nodeVersion}` }
      : runtime.nodeInstalled
        ? { state: 'warning', detail: `版本过低 · ${runtime.nodeVersion ?? '未知'}` }
        : { state: 'warning', detail: '未检测到' },
    npm: runtime.npmInstalled
      ? { state: 'healthy', detail: `已就绪 · ${runtime.npmVersion}` }
      : { state: 'warning', detail: '未检测到' }
  }
}

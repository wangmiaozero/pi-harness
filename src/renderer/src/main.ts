import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { VueQueryPlugin } from '@tanstack/vue-query'
import App from './App.vue'
import router from './router'
import { i18n } from './i18n'
import './styles/main.css'

import { usePiStore } from '@renderer/stores/pi'
import { useProvidersStore } from '@renderer/stores/providers'
import { useModelsStore } from '@renderer/stores/models'
import { useSettingsStore } from '@renderer/stores/settings'
import { useAgentStore } from '@renderer/stores/agent'
import { useHarnessStore } from '@renderer/stores/harness'
import { getApi } from '@renderer/composables/useApi'
import { toast } from 'vue-sonner'
import { applyTheme } from '@renderer/utils/theme'
import { installAuthorWatermark } from '@renderer/utils/author-watermark'
import type { AppUpdateState } from '@shared/ipc/api-types'
import { usePetStore } from '@renderer/stores/pet'
import { installPetRuntimeAdapter } from '@renderer/pet/install-runtime-adapter'
import { MASCOT_ENABLED } from '@shared/feature-flags'
import { runtimeStartupChecks, startupChecks, startupPhase } from './startup'

applyTheme('dark')
installAuthorWatermark()

/* Windows repaints blur/glass effects far more slowly than macOS. The platform
 * attribute lets CSS drop expensive backdrop-filter layers on Windows without
 * forking the stylesheet. */
if (/Win/i.test(navigator.platform)) {
  document.documentElement.dataset.platform = 'win'
}

const app = createApp(App)
const pinia = createPinia()

app.config.errorHandler = (error, _instance, info) => {
  console.error('[vue]', info, error)
}

window.addEventListener('unhandledrejection', (event) => {
  event.preventDefault()
  console.error('[unhandledrejection]', event.reason)
})

window.addEventListener('error', (event) => {
  event.preventDefault()
  console.error('[window.error]', event.error ?? event.message)
})

app.use(pinia)
app.use(router)
app.use(i18n)
app.use(VueQueryPlugin, {
  queryClientConfig: {
    defaultOptions: {
      queries: { retry: 1, refetchOnWindowFocus: false }
    }
  }
})

const piStore = usePiStore()
const providersStore = useProvidersStore()
const modelsStore = useModelsStore()
const settingsStore = useSettingsStore()
const agentStore = useAgentStore()
const harnessStore = useHarnessStore()
const petStore = usePetStore()

const unsubscribers: Array<() => void> = [
  piStore.setupListeners(),
  providersStore.setupListeners(),
  modelsStore.setupListeners(),
  agentStore.setupListeners(),
  harnessStore.setupListeners()
]
if (MASCOT_ENABLED) unsubscribers.push(installPetRuntimeAdapter())

getApi().on('notification', (payload) => {
  const event = payload as { level?: string; title?: string; message?: string }
  const title = event.title ?? 'Pi-Harness'
  const message = event.message
  switch (event.level) {
    case 'success':
      toast.success(title, { description: message })
      break
    case 'warning':
      if (MASCOT_ENABLED) petStore.handleEvent({ type: 'WARNING' })
      toast.warning(title, { description: message })
      break
    case 'error':
      toast.error(title, { description: message })
      break
    default:
      toast.info(title, { description: message })
  }
})

let notifiedUpdateVersion: string | null = null
unsubscribers.push(
  getApi().on('updater-state', (payload) => {
    const state = payload as Partial<AppUpdateState>
    if (
      state.status !== 'downloaded' ||
      !state.latestVersion ||
      state.latestVersion === notifiedUpdateVersion
    ) {
      return
    }
    notifiedUpdateVersion = state.latestVersion
    toast.success(i18n.global.t('settings.updateReadyTitle'), {
      description: i18n.global.t('settings.updateReady', { version: state.latestVersion })
    })
  })
)

async function bootstrap() {
  const networkCheck = getApi()
    .system.checkNetwork()
    .then((result) => {
      startupChecks.network.state = result.reachable ? 'healthy' : 'warning'
      startupChecks.network.detail = result.reachable
        ? `已连接 · ${result.latencyMs} ms`
        : '连接失败'
    })
    .catch(() => {
      startupChecks.network.state = 'error'
      startupChecks.network.detail = '检测失败'
    })
  try {
    await settingsStore.fetch()
    startupPhase.value = 'services'
    const environmentCheck = piStore.detect().then(() => {
      const environment = piStore.environment
      const runtimeChecks = runtimeStartupChecks(environment?.nodeRuntime ?? null)
      Object.assign(startupChecks.node, runtimeChecks.node)
      Object.assign(startupChecks.npm, runtimeChecks.npm)
      startupChecks.pi.state = !environment
        ? 'error'
        : environment.installed
          ? 'healthy'
          : 'warning'
      startupChecks.pi.detail = !environment
        ? '检测失败'
        : environment.installed
          ? '已安装'
          : '未安装'
      startupChecks.config.state = !environment
        ? 'error'
        : !environment.configValid
          ? 'error'
          : environment.configReadable
            ? 'healthy'
            : 'warning'
      startupChecks.config.detail = !environment
        ? '检测失败'
        : !environment.configValid
          ? '配置异常'
          : environment.configReadable
            ? '可读取'
            : '未配置'
    })
    await Promise.all([
      environmentCheck,
      providersStore.fetchList(),
      modelsStore.fetchList(),
      networkCheck
    ])
  } finally {
    startupPhase.value = 'ready'
  }
}

void bootstrap()

app.mount('#app')

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    unsubscribers.forEach((u) => u())
  })
}

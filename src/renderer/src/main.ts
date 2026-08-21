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
import { getApi } from '@renderer/composables/useApi'
import { toast } from 'vue-sonner'
import { applyTheme } from '@renderer/utils/theme'

applyTheme('dark')

const app = createApp(App)
const pinia = createPinia()

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

const unsubscribers: Array<() => void> = [
  piStore.setupListeners(),
  providersStore.setupListeners(),
  modelsStore.setupListeners()
]

getApi().on('notification', (payload) => {
  const event = payload as { level?: string; title?: string; message?: string }
  const title = event.title ?? 'Pi-Harness'
  const message = event.message
  switch (event.level) {
    case 'success':
      toast.success(title, { description: message })
      break
    case 'warning':
      toast.warning(title, { description: message })
      break
    case 'error':
      toast.error(title, { description: message })
      break
    default:
      toast.info(title, { description: message })
  }
})

async function bootstrap() {
  await settingsStore.fetch()
  await Promise.all([piStore.detect(), providersStore.fetchList(), modelsStore.fetchList()])
}

void bootstrap()

app.mount('#app')

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    unsubscribers.forEach((u) => u())
  })
}

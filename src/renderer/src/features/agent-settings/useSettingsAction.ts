import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
export function useSettingsAction() {
  const busy = ref(false),
    error = ref(''),
    message = ref('')
  const { t } = useI18n()
  async function run(action: () => Promise<void>, saved = false): Promise<boolean> {
    if (busy.value) return false
    busy.value = true
    error.value = ''
    message.value = ''
    try {
      await action()
      if (saved) message.value = t('agentSettings.saved')
      return true
    } catch (cause) {
      const e = cause as { userMessage?: string; message?: string }
      error.value = e.userMessage ?? e.message ?? t('common.failed')
      return false
    } finally {
      busy.value = false
    }
  }
  return { busy, error, message, run }
}

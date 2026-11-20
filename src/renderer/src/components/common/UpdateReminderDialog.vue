<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import type { AppUpdateState } from '@shared/update'
import { shouldRemindUpdate } from '@shared/update'
import Dialog from '@renderer/components/ui/Dialog.vue'
import Button from '@renderer/components/ui/Button.vue'
import { getApi } from '@renderer/composables/useApi'

const { t } = useI18n()
const router = useRouter()
const open = ref(false)
const state = ref<AppUpdateState | null>(null)
/** Forgotten when the process exits, so the next launch asks again until they update. */
let dismissedVersion: string | null = null
let ignoreClose = false

function apply(next: AppUpdateState) {
  state.value = next
  const show = shouldRemindUpdate(next, dismissedVersion)
  if (open.value === show) return
  ignoreClose = !show
  open.value = show
}

function dismiss() {
  if (state.value?.latestVersion) dismissedVersion = state.value.latestVersion
  open.value = false
}

async function goUpdate() {
  const current = state.value
  dismiss()
  await router.push('/settings/updates')
  if (!current) return
  if (current.status === 'manual_fallback' || !current.canInstall) {
    await getApi().updater.openReleasePage().catch(() => undefined)
  }
}

watch(open, (value) => {
  if (value) return
  if (ignoreClose) {
    ignoreClose = false
    return
  }
  if (state.value?.latestVersion) dismissedVersion = state.value.latestVersion
})

onMounted(async () => {
  apply(await getApi().updater.state())
})
const stop = getApi().on('updater-state', (payload) => apply(payload as AppUpdateState))
onBeforeUnmount(stop)
</script>

<template>
  <Dialog
    v-model:open="open"
    :title="t('settings.updateRemindTitle', { version: state?.latestVersion ?? '' })"
    :description="
      t('settings.updateRemindBody', {
        current: state?.currentVersion ?? '',
        latest: state?.latestVersion ?? ''
      })
    "
    close-on-escape
  >
    <p class="text-[12px] text-[var(--text-tertiary)]" data-testid="update-remind-dialog">
      {{ t('settings.updateRemindAgain') }}
    </p>
    <template #footer>
      <Button variant="secondary" size="sm" data-testid="update-remind-later" @click="dismiss">
        {{ t('settings.updateRemindLater') }}
      </Button>
      <Button variant="primary" size="sm" data-testid="update-remind-now" @click="goUpdate">
        {{ t('settings.updateRemindNow') }}
      </Button>
    </template>
  </Dialog>
</template>

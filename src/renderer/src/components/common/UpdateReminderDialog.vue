<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AppUpdateState } from '@shared/update'
import { shouldRemindUpdate } from '@shared/update'
import Dialog from '@renderer/components/ui/Dialog.vue'
import Button from '@renderer/components/ui/Button.vue'
import { getApi } from '@renderer/composables/useApi'

const { t } = useI18n()
const open = ref(false)
const state = ref<AppUpdateState | null>(null)
/** Stays open through download and install, including statuses that are not reminders. */
const following = ref(false)
/** Forgotten when the process exits, so the next launch asks again until they update. */
let dismissedVersion: string | null = null
let ignoreClose = false
const progress = computed(() => Math.round(state.value?.downloadProgress ?? 0))
const working = computed(() =>
  ['downloading', 'verifying', 'installing', 'restarting'].includes(state.value?.status ?? '')
)

function formatBytes(bytes: number | null | undefined) {
  if (bytes == null) return '—'
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function apply(next: AppUpdateState) {
  state.value = next
  if (following.value) {
    if (!open.value) {
      ignoreClose = false
      open.value = true
    }
    return
  }
  const show = shouldRemindUpdate(next, dismissedVersion)
  if (open.value === show) return
  ignoreClose = !show
  open.value = show
}

function dismiss() {
  following.value = false
  if (state.value?.latestVersion) dismissedVersion = state.value.latestVersion
  open.value = false
}

async function later() {
  if (state.value?.status === 'downloading' || state.value?.status === 'verifying')
    await getApi()
      .updater.cancel()
      .catch(() => undefined)
  dismiss()
}

async function goUpdate() {
  following.value = true
  open.value = true
  try {
    const next = await getApi().updater.download()
    apply(next)
    if (
      next.downloaded &&
      next.signature === 'verified' &&
      next.integrity === 'verified' &&
      !next.error
    )
      apply(await getApi().updater.apply())
  } catch {
    apply(await getApi().updater.state())
  }
}

watch(open, (value) => {
  if (value) return
  if (ignoreClose) {
    ignoreClose = false
    return
  }
  following.value = false
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
    <div class="space-y-2">
      <div v-if="state?.status === 'downloading'" class="space-y-1">
        <div
          class="h-1.5 overflow-hidden rounded-full bg-[var(--bg-hover)]"
          role="progressbar"
          data-testid="update-remind-progress"
          :aria-valuenow="progress"
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <div class="h-full bg-[var(--accent)]" :style="{ width: `${progress}%` }" />
        </div>
        <p class="text-[12px] text-[var(--text-tertiary)]">
          {{ progress }}% · {{ formatBytes(state.bytesReceived) }} /
          {{ formatBytes(state.totalBytes) }} · {{ formatBytes(state.bytesPerSecond) }}/s
        </p>
      </div>
      <p
        v-else-if="state && working"
        class="text-[12px] text-[var(--text-tertiary)]"
        data-testid="update-remind-dialog"
      >
        {{ t(`settings.updatePhase_${state.status}`) }}
      </p>
      <p v-else class="text-[12px] text-[var(--text-tertiary)]" data-testid="update-remind-dialog">
        {{ t('settings.updateRemindAgain') }}
      </p>
      <p v-if="state?.error" role="alert" class="text-[12px] text-[var(--text-secondary)]">
        {{ state.error.message }}
      </p>
    </div>
    <template #footer>
      <Button
        v-if="state?.downloaded && state.error"
        variant="secondary"
        size="sm"
        @click="getApi().updater.reveal()"
      >
        {{ t('settings.updateShowInstaller') }}
      </Button>
      <Button variant="secondary" size="sm" data-testid="update-remind-later" @click="later">
        {{
          state?.status === 'downloading'
            ? t('settings.updateCancel')
            : t('settings.updateRemindLater')
        }}
      </Button>
      <Button
        variant="primary"
        size="sm"
        data-testid="update-remind-now"
        :disabled="working"
        @click="goUpdate"
      >
        {{ t('settings.updateRemindNow') }}
      </Button>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import type { AppUpdateState } from '@shared/ipc/api-types'
import { APP_VERSION } from '@shared/constants'
import Button from '@renderer/components/ui/Button.vue'
import InspectorSection from '@renderer/components/ui/InspectorSection.vue'
import PropertyRow from '@renderer/components/ui/PropertyRow.vue'
import { getApi } from '@renderer/composables/useApi'
import { askConfirm } from '@renderer/composables/useConfirmDialog'

const { t } = useI18n()

const busy = ref(false)
const state = ref<AppUpdateState | null>(null)

const downloaded = computed(() => Boolean(state.value?.downloaded))
const inProgress = computed(() =>
  ['checking', 'available', 'downloading'].includes(state.value?.status ?? '')
)
const progress = computed(() => Math.round(state.value?.downloadProgress ?? 0))
const currentVersion = computed(() => state.value?.currentVersion ?? APP_VERSION)

const message = computed(() => {
  const current = state.value
  if (!current) return null
  const version = current.latestVersion ?? current.currentVersion
  switch (current.status) {
    case 'checking':
      return t('settings.updateChecking')
    case 'available':
      return t('settings.updateAvailable', { version })
    case 'downloading':
      return t('settings.updateDownloading', { version, progress: progress.value })
    case 'downloaded':
      return t('settings.updateReady', { version })
    case 'not-available':
      return t('settings.updateCurrent', { version: current.currentVersion })
    case 'manual-update':
      return t('settings.updateManualRequired', { version })
    case 'error':
      return t('settings.updateFailed')
    default:
      return null
  }
})

const stopUpdateListener = getApi().on('updater-state', (payload) => {
  const next = payload as Partial<AppUpdateState>
  if (typeof next.status === 'string' && typeof next.currentVersion === 'string') {
    state.value = next as AppUpdateState
  }
})

onMounted(async () => {
  try {
    state.value = await getApi().updater.state()
  } catch {
    state.value = null
  }
})

onBeforeUnmount(() => {
  stopUpdateListener()
})

async function checkUpdates(): Promise<void> {
  busy.value = true
  try {
    const result = await getApi().updater.check()
    state.value = result
    if (result.status === 'error') toast.error(t('settings.updateFailed'))
    else toast.info(message.value ?? t('settings.updateChecking'))
  } catch (e) {
    toast.error((e as { message?: string }).message ?? t('common.failed'))
  } finally {
    busy.value = false
  }
}

async function installUpdate(): Promise<void> {
  const ok = await askConfirm({
    title: t('settings.installUpdateTitle'),
    description: t('settings.installUpdateConfirm'),
    confirmLabel: t('settings.installUpdateAction'),
    tone: 'danger'
  })
  if (!ok) return
  try {
    await getApi().updater.install()
  } catch (e) {
    toast.error((e as { message?: string }).message ?? t('common.failed'))
  }
}

async function openReleasePage(): Promise<void> {
  try {
    await getApi().updater.openReleasePage()
  } catch (e) {
    toast.error((e as { message?: string }).message ?? t('common.failed'))
  }
}
</script>

<template>
  <InspectorSection
    class="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
  >
    <PropertyRow :label="$t('settings.currentVersion')" mono>
      {{ currentVersion }}
    </PropertyRow>
    <div class="border-t border-[var(--border-subtle)] px-3 py-2.5 space-y-2.5">
      <p class="text-[11.5px] text-[var(--text-tertiary)]">
        {{ $t('settings.updatesHint') }}
      </p>
      <p v-if="message" class="text-[12px] text-[var(--text-secondary)]">
        {{ message }}
      </p>
      <div
        v-if="state?.status === 'downloading'"
        class="h-1 overflow-hidden rounded-full bg-[var(--bg-hover)]"
        role="progressbar"
        :aria-valuenow="progress"
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <div
          class="h-full rounded-full bg-[var(--accent)] transition-[width] duration-200"
          :style="{ width: `${progress}%` }"
        />
      </div>
      <div class="flex flex-wrap gap-1.5">
        <Button variant="secondary" size="sm" :loading="busy" :disabled="inProgress" @click="checkUpdates">
          {{ $t('settings.checkUpdates') }}
        </Button>
        <Button
          v-if="state?.status === 'manual-update' || state?.status === 'error'"
          variant="primary"
          size="sm"
          @click="openReleasePage"
        >
          {{ $t('settings.openReleasePage') }}
        </Button>
        <Button v-else variant="primary" size="sm" :disabled="!downloaded" @click="installUpdate">
          {{ $t('settings.installUpdate') }}
        </Button>
      </div>
    </div>
  </InspectorSection>
</template>

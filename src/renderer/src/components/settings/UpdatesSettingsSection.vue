<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import type { AppUpdateState, UpdatePreferences } from '@shared/update'
import { APP_VERSION } from '@shared/constants'
import Button from '@renderer/components/ui/Button.vue'
import InspectorSection from '@renderer/components/ui/InspectorSection.vue'
import PropertyRow from '@renderer/components/ui/PropertyRow.vue'
import { getApi } from '@renderer/composables/useApi'
import { askConfirm } from '@renderer/composables/useConfirmDialog'

const { t } = useI18n()
const api = getApi().updater
const state = ref<AppUpdateState | null>(null)
const busy = ref(false)
const active = computed(() =>
  ['checking', 'downloading', 'verifying', 'installing', 'restarting'].includes(
    state.value?.status ?? ''
  )
)
const progress = computed(() => Math.round(state.value?.downloadProgress ?? 0))
const formatBytes = (bytes: number | null | undefined) =>
  bytes == null
    ? '—'
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`
const message = computed(() => {
  const current = state.value
  if (!current) return ''
  if (current.downloaded && !current.canInstall)
    return t('settings.updateManualDownloaded', { version: current.latestVersion })
  if (current.status === 'idle' && current.latestVersion)
    return t('settings.updateCurrent', { version: current.currentVersion })
  if (current.status === 'available')
    return t('settings.updateOffer', { version: current.latestVersion })
  if (current.status === 'manual_fallback' && current.available && !current.downloaded)
    return t('settings.updateManualRequired', { version: current.latestVersion })
  return t(`settings.updatePhase_${current.status}`)
})
const stop = getApi().on('updater-state', (payload) => {
  state.value = payload as AppUpdateState
})
onMounted(async () => {
  state.value = await api.state()
})
onBeforeUnmount(stop)
async function action(run: () => Promise<AppUpdateState | void>) {
  busy.value = true
  try {
    const next = await run()
    if (next) state.value = next
  } catch (error) {
    toast.error((error as Error).message ?? t('common.failed'))
  } finally {
    busy.value = false
  }
}
async function preferences(key: keyof UpdatePreferences, event: Event) {
  if (!state.value) return
  const next = { ...state.value.preferences, [key]: (event.target as HTMLInputElement).checked }
  await action(() => api.preferences(next))
}
async function install() {
  if (!state.value?.canInstall) return
  if (
    await askConfirm({
      title: t('settings.installUpdateTitle'),
      description: t('settings.installUpdateConfirm'),
      confirmLabel: t('settings.installUpdateAction'),
      tone: 'danger'
    })
  )
    await action(() => api.install())
}
</script>

<template>
  <InspectorSection
    class="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
    data-testid="update-panel"
  >
    <PropertyRow :label="$t('settings.currentVersion')" mono>{{
      state?.currentVersion ?? APP_VERSION
    }}</PropertyRow>
    <PropertyRow v-if="state?.latestVersion" :label="$t('settings.updateLatestVersion')" mono>{{
      state.latestVersion
    }}</PropertyRow>
    <div class="border-t border-[var(--border-subtle)] px-3 py-2.5 space-y-3">
      <p class="text-[11.5px] text-[var(--text-tertiary)]">{{ $t('settings.updatesHint') }}</p>
      <p class="text-[12px] text-[var(--text-secondary)]" role="status">{{ message }}</p>
      <div v-if="state?.fileName" class="space-y-1 text-[11.5px] text-[var(--text-secondary)]">
        <p class="break-all font-mono">
          {{ state.fileName }} · {{ formatBytes(state.totalBytes) }}
        </p>
        <p data-testid="update-signature">
          {{ $t('settings.updateSignature') }}: {{ $t(`settings.updateTrust_${state.signature}`) }}
        </p>
        <p data-testid="update-integrity">
          {{ $t('settings.updateIntegrity') }}: {{ $t(`settings.updateTrust_${state.integrity}`) }}
        </p>
      </div>
      <div v-if="state?.releaseNotes" class="space-y-1">
        <p class="text-[12px] font-medium">{{ $t('settings.updateNotes') }}</p>
        <pre
          class="max-h-52 overflow-auto whitespace-pre-wrap break-words font-sans text-[12px] text-[var(--text-secondary)]"
          data-testid="update-release-notes"
          >{{ state.releaseNotes }}</pre>
      </div>
      <div v-if="state?.status === 'downloading'" class="space-y-1">
        <div
          class="h-1 overflow-hidden rounded-full bg-[var(--bg-hover)]"
          role="progressbar"
          :aria-valuenow="progress"
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <div class="h-full bg-[var(--accent)]" :style="{ width: `${progress}%` }" />
        </div>
        <p class="text-[11.5px] text-[var(--text-tertiary)]">
          {{ progress }}% · {{ formatBytes(state.bytesReceived) }} /
          {{ formatBytes(state.totalBytes) }} · {{ formatBytes(state.bytesPerSecond) }}/s
        </p>
      </div>
      <p
        v-if="state?.error"
        role="alert"
        class="text-[12px] text-[var(--text-secondary)]"
        data-testid="update-error"
      >
        {{ state.error.message }}
      </p>
      <p
        v-if="state?.downloaded && !state.canInstall"
        class="text-[11.5px] text-[var(--text-tertiary)]"
      >
        {{ $t('settings.updateManualGuide') }}
      </p>
      <div class="flex flex-wrap gap-1.5">
        <Button
          variant="secondary"
          size="sm"
          :disabled="active || busy"
          @click="action(() => api.check())"
          >{{ $t('settings.checkUpdates') }}</Button
        >
        <Button
          v-if="state?.signature === 'verified' && state.available && !state.downloaded && !active"
          variant="primary"
          size="sm"
          :disabled="busy"
          @click="action(() => api.download())"
          >{{ $t('settings.downloadInstaller') }}</Button
        >
        <Button
          v-if="state?.status === 'downloading' || state?.status === 'verifying'"
          variant="secondary"
          size="sm"
          @click="action(() => api.cancel())"
          >{{ $t('settings.updateCancel') }}</Button
        >
        <Button
          v-if="state?.error?.retryable && !active"
          variant="secondary"
          size="sm"
          :disabled="busy"
          @click="action(() => api.retry())"
          >{{ $t('settings.updateRetry') }}</Button
        >
        <Button
          v-if="state?.canInstall && state.status === 'ready_to_install'"
          variant="primary"
          size="sm"
          :disabled="busy"
          @click="install"
          >{{ $t('settings.installUpdate') }}</Button
        >
        <Button
          v-if="state?.downloaded && !active"
          variant="secondary"
          size="sm"
          @click="action(() => api.defer())"
          >{{ $t('settings.updateLater') }}</Button
        >
        <Button
          v-if="state?.downloaded && !active"
          variant="primary"
          size="sm"
          @click="action(() => api.reveal())"
          >{{ $t('settings.updateShowInstaller') }}</Button
        >
        <Button variant="secondary" size="sm" @click="action(() => api.openReleasePage())">{{
          $t('settings.openReleasePage')
        }}</Button>
      </div>
      <div v-if="state" class="space-y-2 border-t border-[var(--border-subtle)] pt-3 text-[12px]">
        <label class="flex items-center gap-2"
          ><input
            type="checkbox"
            :checked="state.preferences.autoCheck"
            @change="preferences('autoCheck', $event)"
          />{{ $t('settings.updateAutoCheck') }}</label
        >
        <label class="flex items-center gap-2"
          ><input
            type="checkbox"
            :checked="state.preferences.autoDownload"
            :disabled="!state.autoDownloadAllowed"
            @change="preferences('autoDownload', $event)"
          />{{ $t('settings.updateAutoDownload') }}</label
        >
        <p v-if="!state.autoDownloadAllowed" class="text-[11px] text-[var(--text-tertiary)]">
          {{ $t('settings.updateDownloadConsent') }}
        </p>
      </div>
    </div>
  </InspectorSection>
</template>

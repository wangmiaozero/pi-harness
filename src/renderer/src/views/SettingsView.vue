<script setup lang="ts">
import { ref, computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Save,
  FolderOpen,
  Archive,
  Trash2,
  RotateCcw,
  Eraser,
  CircleOff,
  ChevronDown,
  KeyRound,
  LockKeyhole,
  LockKeyholeOpen
} from '@lucide/vue'
import { toast } from 'vue-sonner'
import type { AppSettings, AppUpdateState } from '@shared/ipc/api-types'
import Button from '@renderer/components/ui/Button.vue'
import Input from '@renderer/components/ui/Input.vue'
import Select from '@renderer/components/ui/Select.vue'
import Badge from '@renderer/components/ui/Badge.vue'
import Switch from '@renderer/components/ui/Switch.vue'
import IconButton from '@renderer/components/ui/IconButton.vue'
import InspectorSection from '@renderer/components/ui/InspectorSection.vue'
import PropertyRow from '@renderer/components/ui/PropertyRow.vue'
import { useSettingsStore } from '@renderer/stores/settings'
import { getApi } from '@renderer/composables/useApi'
import { askConfirm } from '@renderer/composables/useConfirmDialog'
import { formatDateTime, formatBytes } from '@renderer/utils/format'
import { DEFAULT_MASCOT_STYLE, MASCOT_STYLES } from '@shared/constants/mascot'
import { MASCOT_IMAGES } from '@renderer/utils/mascot-images'
import PetDebug from '@renderer/components/pet/PetDebug.vue'

const { t, locale } = useI18n()
const store = useSettingsStore()
const saving = ref(false)
const updateBusy = ref(false)
const updateState = ref<AppUpdateState | null>(null)
const updateSupported = ref(false)
/** Developer / Mock toggles are for local `pnpm dev` only — hidden when packaged. */
const showDeveloper = ref(false)
const mascotExpanded = ref(false)
const mascotUnlockOpen = ref(false)
const mascotUnlocking = ref(false)
const mascotAnswer = ref('')
const mascotUnlockError = ref('')

const updateDownloaded = computed(() => Boolean(updateState.value?.downloaded))
const updateProgress = computed(() => Math.round(updateState.value?.downloadProgress ?? 0))
const updateMessage = computed(() => {
  const current = updateState.value
  if (!current) return null
  const version = current.latestVersion ?? current.currentVersion
  switch (current.status) {
    case 'checking':
      return t('settings.updateChecking')
    case 'available':
      return t('settings.updateAvailable', { version })
    case 'downloading':
      return t('settings.updateDownloading', { version, progress: updateProgress.value })
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

const draft = ref<AppSettings>({
  language: 'zh-CN',
  theme: 'dark',
  density: 'comfortable',
  mascotUnlocked: false,
  mascotStyle: DEFAULT_MASCOT_STYLE,
  petEnabled: false,
  petAnimations: true,
  petStatusText: true,
  petAutoSleep: true,
  petSleepMinutes: 10,
  petSound: false,
  mockMode: false,
  manualCliPath: null,
  manualConfigDir: null,
  autoBackup: true,
  backupRetention: 20,
  developerMode: false,
  defaultToolPreset: 'default',
  restoreTabs: true,
  autoOpenLastProject: true
})

const manualCliPath = computed({
  get: () => draft.value.manualCliPath ?? '',
  set: (v: string) => {
    draft.value.manualCliPath = v.trim() || null
  }
})

const manualConfigDir = computed({
  get: () => draft.value.manualConfigDir ?? '',
  set: (v: string) => {
    draft.value.manualConfigDir = v.trim() || null
  }
})

const backupRetentionStr = computed({
  get: () => String(draft.value.backupRetention),
  set: (v: string) => {
    const n = parseInt(v, 10)
    draft.value.backupRetention = Number.isFinite(n) && n > 0 ? n : 20
  }
})

const petSleepMinutesStr = computed({
  get: () => String(draft.value.petSleepMinutes),
  set: (v: string) => {
    const n = parseInt(v, 10)
    draft.value.petSleepMinutes = Number.isFinite(n) ? Math.min(120, Math.max(1, n)) : 10
  }
})

const languageOptions = computed(() => [
  { value: 'auto', label: t('settings.languageAuto') },
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en-US', label: 'English' }
])

const themeOptions = computed(() => [
  { value: 'system', label: t('settings.themeSystem') },
  { value: 'dark', label: t('settings.themeDark') },
  { value: 'light', label: t('settings.themeLight') }
])

const densityOptions = computed(() => [
  { value: 'comfortable', label: t('settings.densityComfortable') },
  { value: 'compact', label: t('settings.densityCompact') }
])

const mascotOptions = computed(() =>
  MASCOT_STYLES.map((style) => ({
    value: style,
    image: MASCOT_IMAGES[style],
    label: t(`settings.mascot${style[0].toUpperCase()}${style.slice(1)}`),
    description: t(`settings.mascot${style[0].toUpperCase()}${style.slice(1)}Hint`)
  }))
)

const toolPresetOptions = computed(() => [
  { value: 'none', label: t('workspace.presetNone') },
  { value: 'read-only', label: t('workspace.presetReadOnly') },
  { value: 'default', label: t('workspace.presetDefault') },
  { value: 'full', label: t('workspace.presetFull') }
])

watch(
  () => store.settings,
  (s) => {
    if (s) draft.value = { ...s }
  },
  { immediate: true }
)

async function saveSettings() {
  saving.value = true
  try {
    if (!draft.value.mascotUnlocked) {
      draft.value.mascotStyle = DEFAULT_MASCOT_STYLE
      draft.value.petEnabled = false
    }
    await store.patch({ ...draft.value })
    toast.success(t('settings.saved'))
  } catch (e) {
    toast.error((e as { message?: string }).message ?? t('common.failed'))
  } finally {
    saving.value = false
  }
}

function toggleMascotSection(): void {
  if (!draft.value.mascotUnlocked) {
    mascotUnlockOpen.value = !mascotUnlockOpen.value
    mascotExpanded.value = false
    mascotUnlockError.value = ''
    return
  }
  mascotExpanded.value = !mascotExpanded.value
}

async function unlockMascot(): Promise<void> {
  if (mascotUnlocking.value) return
  mascotUnlocking.value = true
  mascotUnlockError.value = ''
  try {
    const unlocked = await store.unlockMascot(mascotAnswer.value)
    if (!unlocked) {
      mascotUnlockError.value = t('settings.mascotUnlockIncorrect')
      return
    }
    draft.value.mascotUnlocked = true
    draft.value.mascotStyle = DEFAULT_MASCOT_STYLE
    draft.value.petEnabled = false
    mascotAnswer.value = ''
    mascotUnlockOpen.value = false
    mascotExpanded.value = true
    toast.success(t('settings.mascotUnlockSuccess'))
  } catch (error) {
    toast.error((error as { message?: string }).message ?? t('common.failed'))
  } finally {
    mascotUnlocking.value = false
  }
}

async function createBackup() {
  try {
    await store.createBackup('manual')
    toast.success(t('settings.backupCreated'))
  } catch (e) {
    toast.error((e as { message?: string }).message ?? t('common.failed'))
  }
}

async function restoreBackup(id: string) {
  const ok = await askConfirm({
    title: t('settings.restoreTitle'),
    description: t('settings.restoreConfirm'),
    confirmLabel: t('settings.restoreAction'),
    tone: 'danger'
  })
  if (!ok) return
  try {
    await store.restoreBackup(id)
    toast.success(t('settings.backupRestored'))
  } catch (e) {
    toast.error((e as { message?: string }).message ?? t('common.failed'))
  }
}

async function deleteBackup(id: string) {
  const ok = await askConfirm({
    title: t('settings.deleteBackupTitle'),
    description: t('settings.deleteBackupConfirm'),
    confirmLabel: t('settings.deleteBackupAction'),
    tone: 'danger'
  })
  if (!ok) return
  try {
    await store.deleteBackup(id)
    toast.success(t('settings.backupDeleted'))
  } catch (e) {
    toast.error((e as { message?: string }).message ?? t('common.failed'))
  }
}

async function cleanupBackups() {
  const retention = draft.value.backupRetention
  const deleteCount = Math.max(0, store.backups.length - retention)
  if (deleteCount === 0) {
    toast.info(t('settings.cleanupNone', { count: retention }))
    return
  }
  const ok = await askConfirm({
    title: t('settings.cleanupTitle'),
    description: t('settings.cleanupConfirm', { retention, count: deleteCount }),
    confirmLabel: t('settings.cleanupAction'),
    tone: 'danger'
  })
  if (!ok) return
  try {
    const result = await store.pruneBackups(retention)
    toast.success(
      t('settings.cleanupDone', {
        count: result.deleted,
        size: formatBytes(result.freedBytes)
      })
    )
  } catch (e) {
    toast.error((e as { message?: string }).message ?? t('common.failed'))
  }
}

async function checkUpdates() {
  updateBusy.value = true
  try {
    const result = await getApi().updater.check()
    updateState.value = result
    if (result.status === 'error') toast.error(t('settings.updateFailed'))
    else if (result.available) toast.info(updateMessage.value ?? t('settings.updateChecking'))
    else toast.info(updateMessage.value ?? t('settings.updateFailed'))
  } catch (e) {
    toast.error((e as { message?: string }).message ?? t('common.failed'))
  } finally {
    updateBusy.value = false
  }
}

const stopUpdateListener = getApi().on('updater-state', (payload) => {
  const next = payload as Partial<AppUpdateState>
  if (typeof next.status === 'string' && typeof next.currentVersion === 'string') {
    updateState.value = next as AppUpdateState
  }
})

async function installUpdate() {
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

onMounted(() => {
  void Promise.all([store.fetch(), store.fetchBackups()])
  void getApi()
    .system.info()
    .then(async (info) => {
      showDeveloper.value = !info.packaged
      updateSupported.value = info.packaged
      if (info.packaged) updateState.value = await getApi().updater.state()
    })
    .catch(() => {
      showDeveloper.value = false
      updateSupported.value = false
    })
})

onBeforeUnmount(stopUpdateListener)
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <header
      class="flex shrink-0 items-center justify-between gap-3 px-5 h-[var(--height-page-header)] border-b border-[var(--border-subtle)]"
    >
      <div class="min-w-0">
        <h1 class="text-[15px] font-semibold tracking-tight text-[var(--text-primary)]">
          {{ $t('settings.title') }}
        </h1>
        <p class="text-[11.5px] text-[var(--text-tertiary)] -mt-0.5">
          {{ $t('settings.subtitle') }}
        </p>
      </div>
      <Button variant="primary" size="sm" :loading="saving" @click="saveSettings">
        <Save class="size-3.5" :stroke-width="1.75" />
        {{ $t('common.save') }}
      </Button>
    </header>

    <div class="flex-1 overflow-y-auto">
      <div class="mx-auto max-w-[720px] px-6 py-5 space-y-5">
        <!-- General — Inspector property rows. No Card. -->
        <InspectorSection
          class="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
        >
          <template #title>{{ $t('settings.general') }}</template>
          <div
            class="divide-y divide-[var(--border-subtle)] border-t border-[var(--border-subtle)]"
          >
            <Select
              v-model="draft.language"
              :label="$t('settings.language')"
              :options="languageOptions"
              layout="row"
            />
            <Select
              v-model="draft.theme"
              :label="$t('settings.theme')"
              :options="themeOptions"
              layout="row"
            />
            <Select
              v-model="draft.density"
              :label="$t('settings.density')"
              :options="densityOptions"
              layout="row"
            />
          </div>
        </InspectorSection>

        <section
          data-testid="mascot-settings-section"
          class="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
        >
          <button
            type="button"
            data-testid="mascot-section-toggle"
            class="flex h-[34px] w-full items-center justify-between gap-3 px-3 text-left transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] disabled:cursor-wait disabled:hover:bg-transparent"
            :disabled="store.loading || !store.settings"
            :aria-expanded="draft.mascotUnlocked ? mascotExpanded : mascotUnlockOpen"
            aria-controls="mascot-settings-content"
            @click="toggleMascotSection"
          >
            <span class="flex min-w-0 items-center gap-2">
              <LockKeyholeOpen
                v-if="draft.mascotUnlocked"
                class="size-3.5 shrink-0 text-[var(--success)]"
                :stroke-width="1.75"
              />
              <LockKeyhole
                v-else
                class="size-3.5 shrink-0 text-[var(--warning)]"
                :stroke-width="1.75"
              />
              <span
                class="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[var(--text-tertiary)]"
              >
                {{ $t('settings.mascot') }}
              </span>
              <Badge :tone="draft.mascotUnlocked ? 'success' : 'warning'">
                {{
                  draft.mascotUnlocked ? $t('settings.mascotUnlocked') : $t('settings.mascotLocked')
                }}
              </Badge>
            </span>
            <ChevronDown
              class="size-3.5 shrink-0 text-[var(--text-tertiary)] transition-transform duration-150"
              :class="
                draft.mascotUnlocked
                  ? mascotExpanded && 'rotate-180'
                  : mascotUnlockOpen && 'rotate-180'
              "
              :stroke-width="1.75"
            />
          </button>

          <div
            v-if="!draft.mascotUnlocked && mascotUnlockOpen"
            id="mascot-settings-content"
            class="border-t border-[var(--border-subtle)] p-3"
          >
            <form
              data-testid="mascot-unlock-form"
              class="rounded-[var(--radius-sm)] border border-[var(--warning)]/30 bg-[var(--warning-tint)] p-3"
              @submit.prevent="unlockMascot"
            >
              <div class="flex items-start gap-2.5">
                <KeyRound
                  class="mt-0.5 size-4 shrink-0 text-[var(--warning)]"
                  :stroke-width="1.75"
                />
                <div class="min-w-0 flex-1">
                  <label
                    for="mascot-unlock-answer"
                    class="block text-[12px] font-semibold text-[var(--text-primary)]"
                  >
                    {{ $t('settings.mascotUnlockQuestion') }}
                  </label>
                  <p class="mt-0.5 text-[10.5px] text-[var(--text-tertiary)]">
                    {{ $t('settings.mascotLockedHint') }}
                  </p>
                  <div class="mt-2 flex items-start gap-2">
                    <div class="min-w-0 flex-1">
                      <input
                        id="mascot-unlock-answer"
                        v-model="mascotAnswer"
                        data-testid="mascot-unlock-answer"
                        type="password"
                        inputmode="numeric"
                        autocomplete="off"
                        :placeholder="$t('settings.mascotUnlockPlaceholder')"
                        class="h-[var(--height-input)] w-full rounded-[var(--radius-sm)] border border-[var(--control-border)] bg-[var(--control-bg)] px-2.5 font-[family-name:var(--font-mono)] text-[12px] text-[var(--text-primary)] shadow-[var(--control-shadow)] placeholder:text-[var(--control-placeholder)] hover:border-[var(--control-border-hover)] focus:border-[var(--accent)] focus:outline-none focus:shadow-[var(--focus-ring)]"
                        :aria-invalid="Boolean(mascotUnlockError)"
                        :aria-describedby="mascotUnlockError ? 'mascot-unlock-error' : undefined"
                        @input="mascotUnlockError = ''"
                      />
                      <p
                        v-if="mascotUnlockError"
                        id="mascot-unlock-error"
                        role="alert"
                        class="mt-1 text-[10.5px] text-[var(--error)]"
                      >
                        {{ mascotUnlockError }}
                      </p>
                    </div>
                    <Button
                      type="submit"
                      variant="primary"
                      size="sm"
                      :loading="mascotUnlocking"
                      :disabled="!mascotAnswer.trim() || mascotUnlocking"
                    >
                      {{ $t('settings.mascotUnlockAction') }}
                    </Button>
                  </div>
                </div>
              </div>
            </form>
          </div>

          <div
            v-else-if="draft.mascotUnlocked && mascotExpanded"
            id="mascot-settings-content"
            class="border-t border-[var(--border-subtle)] p-3"
          >
            <p class="mb-3 text-[11.5px] text-[var(--text-tertiary)]">
              {{ $t('settings.mascotHint') }}
            </p>
            <div class="grid grid-cols-2 gap-2.5 min-[900px]:grid-cols-3">
              <button
                v-for="option in mascotOptions"
                :key="option.value"
                type="button"
                class="group min-w-0 overflow-hidden rounded-[var(--radius-md)] border text-left transition-[background-color,border-color,box-shadow] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
                :class="
                  draft.mascotStyle === option.value
                    ? 'border-[var(--accent-border)] bg-[var(--accent-tint-soft)]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-surface-raised)] hover:border-[var(--border-default)] hover:bg-[var(--bg-hover)]'
                "
                :aria-pressed="draft.mascotStyle === option.value"
                @click="draft.mascotStyle = option.value"
              >
                <div class="h-32 bg-[var(--bg-window)]/45 px-2 pt-2">
                  <img
                    v-if="option.image"
                    :src="option.image"
                    alt=""
                    loading="lazy"
                    class="size-full object-contain object-bottom transition-transform duration-150 group-hover:scale-[1.025]"
                  />
                  <div
                    v-else
                    class="flex size-full items-center justify-center text-[var(--text-tertiary)]"
                  >
                    <CircleOff class="size-10" :stroke-width="1.25" />
                  </div>
                </div>
                <div class="border-t border-[var(--border-subtle)] px-2.5 py-2">
                  <div class="flex min-w-0 items-center gap-1.5">
                    <div class="truncate text-[12px] font-medium text-[var(--text-primary)]">
                      {{ option.label }}
                    </div>
                  </div>
                  <div
                    class="mt-0.5 line-clamp-2 text-[10.5px] leading-4 text-[var(--text-tertiary)]"
                  >
                    {{ option.description }}
                  </div>
                </div>
              </button>
            </div>
            <div
              class="mt-3 divide-y divide-[var(--border-subtle)] overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border-subtle)]"
            >
              <PropertyRow :label="$t('settings.petEnabled')">
                <Switch v-model="draft.petEnabled" :label="$t('settings.petEnabled')" />
              </PropertyRow>
              <PropertyRow :label="$t('settings.petAnimations')">
                <Switch v-model="draft.petAnimations" :label="$t('settings.petAnimations')" />
              </PropertyRow>
              <PropertyRow :label="$t('settings.petStatusText')">
                <Switch v-model="draft.petStatusText" :label="$t('settings.petStatusText')" />
              </PropertyRow>
              <PropertyRow :label="$t('settings.petAutoSleep')">
                <Switch v-model="draft.petAutoSleep" :label="$t('settings.petAutoSleep')" />
              </PropertyRow>
              <PropertyRow :label="$t('settings.petSleepMinutes')">
                <Input
                  v-model="petSleepMinutesStr"
                  type="number"
                  min="1"
                  max="120"
                  class="w-20"
                  :disabled="!draft.petAutoSleep"
                />
              </PropertyRow>
              <PropertyRow :label="$t('settings.petSound')">
                <Switch v-model="draft.petSound" :label="$t('settings.petSound')" />
              </PropertyRow>
            </div>
          </div>
        </section>

        <InspectorSection
          class="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
        >
          <template #title>{{ $t('settings.workspace') }}</template>
          <div
            class="divide-y divide-[var(--border-subtle)] border-t border-[var(--border-subtle)]"
          >
            <Select
              v-model="draft.defaultToolPreset"
              :label="$t('settings.defaultToolPreset')"
              :options="toolPresetOptions"
              layout="row"
            />
            <PropertyRow :label="$t('settings.restoreTabs')">
              <div class="flex items-center justify-end">
                <Switch v-model="draft.restoreTabs" :label="$t('settings.restoreTabs')" />
              </div>
            </PropertyRow>
            <PropertyRow :label="$t('settings.autoOpenLastProject')">
              <div class="flex items-center justify-end">
                <Switch
                  v-model="draft.autoOpenLastProject"
                  :label="$t('settings.autoOpenLastProject')"
                />
              </div>
            </PropertyRow>
          </div>
        </InspectorSection>

        <!-- Manual paths — same pattern. -->
        <InspectorSection
          class="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
        >
          <template #title>{{ $t('settings.manualPaths') }}</template>
          <div
            class="divide-y divide-[var(--border-subtle)] border-t border-[var(--border-subtle)]"
          >
            <Input
              v-model="manualCliPath"
              :label="$t('settings.cliPath')"
              :hint="$t('settings.cliPathHint')"
              placeholder="/usr/local/bin/pi"
              layout="row"
              mono
            />
            <Input
              v-model="manualConfigDir"
              :label="$t('settings.configDir')"
              :hint="$t('settings.configDirHint')"
              placeholder="~/.pi/agent"
              layout="row"
              mono
            />
          </div>
        </InspectorSection>

        <!-- Backup — property rows + a compact backup list (resource list style). -->
        <InspectorSection
          class="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
        >
          <template #title>{{ $t('settings.backup') }}</template>
          <PropertyRow :label="$t('settings.autoBackup')">
            <div class="flex items-center justify-end">
              <Switch v-model="draft.autoBackup" :label="$t('settings.autoBackup')" />
            </div>
          </PropertyRow>
          <PropertyRow :label="$t('settings.retention')">
            <input
              v-model="backupRetentionStr"
              type="number"
              min="1"
              step="1"
              :aria-label="$t('settings.retention')"
              class="h-[var(--height-input)] w-[88px] rounded-[var(--radius-sm)] border border-[var(--control-border)] bg-[var(--control-bg)] px-2.5 text-right text-[12px] tabular-nums text-[var(--text-primary)] shadow-[var(--control-shadow)] transition-[background-color,border-color,box-shadow] hover:border-[var(--control-border-hover)] hover:bg-[var(--control-bg-hover)] focus:border-[var(--accent)] focus:bg-[var(--control-bg-hover)] focus:outline-none focus:shadow-[var(--focus-ring)]"
            />
          </PropertyRow>
          <div
            class="px-3 py-2 flex flex-wrap items-center gap-1.5 border-t border-[var(--border-subtle)]"
          >
            <Button variant="secondary" size="sm" @click="createBackup">
              <Archive class="size-3.5" :stroke-width="1.75" />
              {{ $t('settings.createBackup') }}
            </Button>
            <Button variant="secondary" size="sm" @click="cleanupBackups">
              <Eraser class="size-3.5" :stroke-width="1.75" />
              {{ $t('settings.cleanupBackups') }}
            </Button>
            <Button variant="ghost" size="sm" @click="store.openBackupFolder">
              <FolderOpen class="size-3.5" :stroke-width="1.75" />
              {{ $t('settings.openFolder') }}
            </Button>
          </div>
          <p class="px-3 pb-2 text-[10.5px] text-[var(--text-tertiary)]">
            {{ $t('settings.cleanupHint', { count: draft.backupRetention }) }}
          </p>
          <div class="border-t border-[var(--border-subtle)]">
            <div
              v-if="store.backupsLoading"
              class="px-3 py-3 text-[11.5px] text-[var(--text-tertiary)]"
            >
              {{ $t('settings.loadingBackups') }}
            </div>
            <div
              v-else-if="store.backups.length === 0"
              class="px-3 py-3 text-[11.5px] text-[var(--text-tertiary)]"
            >
              {{ $t('settings.noBackups') }}
            </div>
            <ul v-else class="divide-y divide-[var(--border-subtle)]">
              <li
                v-for="backup in store.backups"
                :key="backup.id"
                class="group flex items-center gap-3 px-3 py-1.5 hover:bg-[var(--bg-hover)]"
              >
                <div class="min-w-0 flex-1">
                  <div
                    class="truncate text-[12px] text-[var(--text-primary)]"
                    :title="
                      formatDateTime(backup.timestamp, locale === 'zh-CN' ? 'zh-CN' : 'en-US')
                    "
                  >
                    {{ formatDateTime(backup.timestamp, locale === 'zh-CN' ? 'zh-CN' : 'en-US') }}
                  </div>
                  <div class="flex items-center gap-1.5 mt-0.5">
                    <Badge tone="muted">
                      {{ backup.reason }}
                    </Badge>
                    <span class="text-[10.5px] text-[var(--text-tertiary)] tabular-nums">
                      {{ formatBytes(backup.sizeBytes) }}
                    </span>
                  </div>
                </div>
                <div
                  class="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
                >
                  <IconButton :label="$t('common.restore')" @click="restoreBackup(backup.id)">
                    <RotateCcw class="size-3.5" :stroke-width="1.75" />
                  </IconButton>
                  <IconButton
                    variant="danger"
                    :label="$t('common.delete')"
                    @click="deleteBackup(backup.id)"
                  >
                    <Trash2 class="size-3.5" :stroke-width="1.75" />
                  </IconButton>
                </div>
              </li>
            </ul>
          </div>
        </InspectorSection>

        <!-- Updates -->
        <InspectorSection
          v-if="updateSupported"
          class="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
        >
          <template #title>{{ $t('settings.updates') }}</template>
          <div class="px-3 py-2.5 space-y-2.5">
            <p class="text-[11.5px] text-[var(--text-tertiary)]">
              {{ $t('settings.updatesHint') }}
            </p>
            <p v-if="updateMessage" class="text-[12px] text-[var(--text-secondary)]">
              {{ updateMessage }}
            </p>
            <div
              v-if="updateState?.status === 'downloading'"
              class="h-1 overflow-hidden rounded-full bg-[var(--bg-hover)]"
              role="progressbar"
              :aria-valuenow="updateProgress"
              aria-valuemin="0"
              aria-valuemax="100"
            >
              <div
                class="h-full rounded-full bg-[var(--accent)] transition-[width] duration-200"
                :style="{ width: `${updateProgress}%` }"
              />
            </div>
            <div class="flex flex-wrap gap-1.5">
              <Button variant="secondary" size="sm" :loading="updateBusy" @click="checkUpdates">
                {{ $t('settings.checkUpdates') }}
              </Button>
              <Button
                variant="primary"
                size="sm"
                :disabled="!updateDownloaded"
                @click="installUpdate"
              >
                {{ $t('settings.installUpdate') }}
              </Button>
            </div>
          </div>
        </InspectorSection>

        <!-- Developer — only in unpackaged / pnpm dev builds -->
        <InspectorSection
          v-if="showDeveloper"
          class="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
        >
          <template #title>{{ $t('settings.developer') }}</template>
          <PropertyRow :label="$t('settings.developerMode')">
            <div class="flex items-center justify-end">
              <Switch v-model="draft.developerMode" :label="$t('settings.developerMode')" />
            </div>
          </PropertyRow>
          <PropertyRow :label="$t('settings.mockMode')">
            <div class="flex items-center justify-end">
              <Switch v-model="draft.mockMode" :label="$t('settings.mockMode')" />
            </div>
          </PropertyRow>
          <PetDebug v-if="draft.developerMode" :style="draft.mascotStyle" />
        </InspectorSection>
      </div>
    </div>
  </div>
</template>

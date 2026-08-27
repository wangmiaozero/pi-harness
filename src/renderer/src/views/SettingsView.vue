<script setup lang="ts">
import { ref, computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  Save,
  FolderOpen,
  Archive,
  Trash2,
  RotateCcw,
  Eraser,
  CircleOff,
  ArrowLeft,
  KeyRound,
  SlidersHorizontal,
  PanelLeft,
  Sparkles,
  AppWindow,
  Download,
  Code2
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
import {
  DEFAULT_MASCOT_STYLE,
  MASCOT_STYLES,
  STARSHIP_COCKPIT_MASCOT_STYLE,
  type MascotStyle
} from '@shared/constants/mascot'
import { DEFAULT_NAV_ORDER, normalizeNavOrder } from '@shared/constants/navigation'
import NavOrderList from '@renderer/components/settings/NavOrderList.vue'
import { MASCOT_IMAGES } from '@renderer/utils/mascot-images'
import PetDebug from '@renderer/components/pet/PetDebug.vue'

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const store = useSettingsStore()
const saving = ref(false)
const updateBusy = ref(false)
const updateState = ref<AppUpdateState | null>(null)
const updateSupported = ref(false)
/** Developer / Mock toggles are for local `pnpm dev` only — hidden when packaged. */
const showDeveloper = ref(false)
const menuReady = ref(false)
const mascotUnlocking = ref(false)
const mascotAnswer = ref('')
const mascotUnlockError = ref('')

const SETTINGS_SECTIONS = [
  'general',
  'nav',
  'mascot',
  'workspace',
  'paths',
  'backup',
  'updates',
  'developer'
] as const
type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]

function isSettingsSection(value: unknown): value is SettingsSectionId {
  return typeof value === 'string' && (SETTINGS_SECTIONS as readonly string[]).includes(value)
}

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
  autoOpenLastProject: true,
  windowMotionEnabled: false,
  screenMotionEnabled: true,
  navOrder: [...DEFAULT_NAV_ORDER]
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

const navOrderIsDefault = computed(
  () =>
    draft.value.navOrder.length === DEFAULT_NAV_ORDER.length &&
    draft.value.navOrder.every((id, index) => id === DEFAULT_NAV_ORDER[index])
)

const section = computed<SettingsSectionId | null>(() => {
  const raw = route.params.section
  const id = Array.isArray(raw) ? raw[0] : raw
  return isSettingsSection(id) ? id : null
})

const sectionTitle = computed(() => {
  switch (section.value) {
    case 'general':
      return t('settings.general')
    case 'nav':
      return t('settings.navOrder')
    case 'mascot':
      return t('settings.mascot')
    case 'workspace':
      return t('settings.workspace')
    case 'paths':
      return t('settings.manualPaths')
    case 'backup':
      return t('settings.backup')
    case 'updates':
      return t('settings.updates')
    case 'developer':
      return t('settings.developer')
    default:
      return t('settings.title')
  }
})

const sectionSubtitle = computed(() => {
  switch (section.value) {
    case 'general':
      return t('settings.sectionGeneralHint')
    case 'nav':
      return t('settings.sectionNavHint')
    case 'mascot':
      return t('settings.sectionMascotHint')
    case 'workspace':
      return t('settings.sectionWorkspaceHint')
    case 'paths':
      return t('settings.sectionPathsHint')
    case 'backup':
      return t('settings.sectionBackupHint')
    case 'updates':
      return t('settings.sectionUpdatesHint')
    case 'developer':
      return t('settings.sectionDeveloperHint')
    default:
      return t('settings.subtitle')
  }
})

type SettingsMenuIcon = typeof SlidersHorizontal

const settingsMenu = computed(() => {
  const items: {
    id: SettingsSectionId
    title: string
    hint: string
    icon: SettingsMenuIcon
  }[] = [
    {
      id: 'general',
      title: t('settings.general'),
      hint: t('settings.sectionGeneralHint'),
      icon: SlidersHorizontal
    },
    {
      id: 'nav',
      title: t('settings.navOrder'),
      hint: t('settings.sectionNavHint'),
      icon: PanelLeft
    },
    {
      id: 'mascot',
      title: t('settings.mascot'),
      hint: t('settings.sectionMascotHint'),
      icon: Sparkles
    },
    {
      id: 'workspace',
      title: t('settings.workspace'),
      hint: t('settings.sectionWorkspaceHint'),
      icon: AppWindow
    },
    {
      id: 'paths',
      title: t('settings.manualPaths'),
      hint: t('settings.sectionPathsHint'),
      icon: FolderOpen
    },
    {
      id: 'backup',
      title: t('settings.backup'),
      hint: t('settings.sectionBackupHint'),
      icon: Archive
    }
  ]
  if (updateSupported.value) {
    items.push({
      id: 'updates',
      title: t('settings.updates'),
      hint: t('settings.sectionUpdatesHint'),
      icon: Download
    })
  }
  if (showDeveloper.value) {
    items.push({
      id: 'developer',
      title: t('settings.developer'),
      hint: t('settings.sectionDeveloperHint'),
      icon: Code2
    })
  }
  return items
})

const settingsHomeEmptySlots = computed(() => Math.max(0, 9 - settingsMenu.value.length))

watch(
  () => store.settings,
  (s) => {
    if (s) draft.value = { ...s, navOrder: normalizeNavOrder(s.navOrder) }
  },
  { immediate: true }
)

watch([section, showDeveloper, updateSupported, menuReady], ([, developer, updates, ready]) => {
  const raw = route.params.section
  const requested = Array.isArray(raw) ? raw[0] : raw
  if (!requested) return
  if (!isSettingsSection(requested)) {
    void router.replace('/settings')
    return
  }
  if (!ready) return
  if (requested === 'developer' && !developer) void router.replace('/settings')
  if (requested === 'updates' && !updates) void router.replace('/settings')
})

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

function resetNavOrder(): void {
  draft.value.navOrder = [...DEFAULT_NAV_ORDER]
}

function goBackToSettingsHome(): void {
  void router.push('/settings')
}

function selectMascot(style: MascotStyle): void {
  draft.value.mascotStyle = style
  if (style === STARSHIP_COCKPIT_MASCOT_STYLE) draft.value.petEnabled = true
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
    mascotUnlockError.value = ''
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
      menuReady.value = true
      if (info.packaged) updateState.value = await getApi().updater.state()
    })
    .catch(() => {
      showDeveloper.value = false
      updateSupported.value = false
      menuReady.value = true
    })
})

onBeforeUnmount(stopUpdateListener)
</script>

<template>
  <div class="settings-view flex h-full min-h-0 flex-col">
    <header
      class="flex shrink-0 items-center justify-between gap-3 px-5 h-[var(--height-page-header)] border-b border-[var(--border-subtle)]"
    >
      <div class="flex min-w-0 items-center gap-2 self-stretch">
        <IconButton
          v-if="section"
          :label="$t('settings.back')"
          data-testid="settings-back"
          @click="goBackToSettingsHome"
        >
          <ArrowLeft class="size-3.5" :stroke-width="1.75" />
        </IconButton>
        <div class="flex min-w-0 flex-col justify-center self-stretch">
          <h1
            class="text-[15px] font-semibold leading-[18px] tracking-tight text-[var(--text-primary)]"
          >
            {{ sectionTitle }}
          </h1>
          <p class="mt-[3px] text-[11.5px] leading-[14px] text-[var(--text-tertiary)]">
            {{ sectionSubtitle }}
          </p>
        </div>
      </div>
      <Button variant="primary" size="sm" :loading="saving" @click="saveSettings">
        <Save class="size-3.5" :stroke-width="1.75" />
        {{ $t('common.save') }}
      </Button>
    </header>

    <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div v-if="!section" class="flex min-h-0 flex-1 flex-col p-5">
        <nav
          data-testid="settings-home"
          class="grid min-h-0 flex-1 grid-cols-3 grid-rows-3 gap-3 overflow-hidden"
        >
          <RouterLink
            v-for="item in settingsMenu"
            :key="item.id"
            :to="`/settings/${item.id}`"
            :data-testid="`settings-section-${item.id}`"
            class="settings-home-card group flex min-h-0 flex-col justify-between rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 no-drag shadow-[var(--shadow-popover)] transition-[background-color,border-color,box-shadow] hover:border-[var(--border-default)] hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
          >
            <component
              :is="item.icon"
              class="size-5 text-[var(--text-secondary)] transition-colors group-hover:text-[var(--text-primary)]"
              :stroke-width="1.75"
            />
            <span class="min-w-0">
              <span class="flex items-center gap-2">
                <span class="text-[14px] font-medium text-[var(--text-primary)]">
                  {{ item.title }}
                </span>
                <Badge
                  v-if="item.id === 'mascot'"
                  :tone="draft.mascotUnlocked ? 'success' : 'warning'"
                >
                  {{
                    draft.mascotUnlocked
                      ? $t('settings.mascotUnlocked')
                      : $t('settings.mascotLocked')
                  }}
                </Badge>
              </span>
              <span class="mt-1 block text-[12px] leading-snug text-[var(--text-tertiary)]">
                {{ item.hint }}
              </span>
            </span>
          </RouterLink>
          <div
            v-for="slot in settingsHomeEmptySlots"
            :key="`empty-${slot}`"
            class="rounded-[var(--radius-lg)] border border-[var(--border-subtle)]/50 bg-[var(--bg-surface)]/30"
            aria-hidden="true"
          />
        </nav>
      </div>

      <div v-else class="flex-1 overflow-y-auto">
        <div class="mx-auto w-full max-w-[720px] space-y-5 px-6 py-5">
        <!-- General — Inspector property rows. No Card. -->
        <InspectorSection
          v-if="section === 'general'"
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
            <PropertyRow :label="$t('settings.windowMotionEnabled')">
              <div class="flex items-center justify-end">
                <Switch
                  v-model="draft.windowMotionEnabled"
                  :label="$t('settings.windowMotionEnabled')"
                  data-testid="window-motion-toggle"
                />
              </div>
            </PropertyRow>
            <PropertyRow :label="$t('settings.screenMotionEnabled')">
              <div class="flex items-center justify-end">
                <Switch
                  v-model="draft.screenMotionEnabled"
                  :label="$t('settings.screenMotionEnabled')"
                  data-testid="screen-motion-toggle"
                />
              </div>
            </PropertyRow>
          </div>
        </InspectorSection>

        <section
          v-else-if="section === 'nav'"
          data-testid="nav-order-section"
          class="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
        >
          <div class="flex items-center justify-between gap-2 px-3 py-2">
            <p class="text-[11.5px] text-[var(--text-tertiary)]">
              {{ $t('settings.navOrderHint') }}
            </p>
            <Button
              variant="ghost"
              size="sm"
              :disabled="navOrderIsDefault"
              data-testid="nav-order-reset"
              @click="resetNavOrder"
            >
              <RotateCcw class="size-3" :stroke-width="1.75" />
              {{ $t('settings.navOrderReset') }}
            </Button>
          </div>
          <NavOrderList v-model="draft.navOrder" />
        </section>

        <section
          v-else-if="section === 'mascot'"
          data-testid="mascot-settings-section"
          class="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
        >
          <div v-if="!draft.mascotUnlocked" id="mascot-settings-content" class="p-3">
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

          <div v-else id="mascot-settings-content" class="p-3">
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
                :data-mascot-option="option.value"
                @click="selectMascot(option.value)"
              >
                <div class="mascot-option-preview h-32 bg-[var(--bg-window)]/45 px-2 pt-2">
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
            </div>
          </div>
        </section>

        <InspectorSection
          v-else-if="section === 'workspace'"
          class="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
        >
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

        <InspectorSection
          v-else-if="section === 'paths'"
          class="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
        >
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

        <InspectorSection
          v-else-if="section === 'backup'"
          class="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
        >
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

        <InspectorSection
          v-else-if="section === 'updates'"
          class="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
        >
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

        <InspectorSection
          v-else-if="section === 'developer'"
          class="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
        >
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
  </div>
</template>

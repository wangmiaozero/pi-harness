import { nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import type { AppSettings } from '@shared/ipc/api-types'
import { DEFAULT_MASCOT_STYLE } from '@shared/constants/mascot'
import { DEFAULT_NAV_ORDER, normalizeNavOrder } from '@shared/constants/navigation'
import { useSettingsStore } from '@renderer/stores/settings'

/**
 * Debounce window that coalesces rapid setting changes into one IPC write.
 * Every draft mutation autosaves; leaving the view flushes a pending save.
 */
const AUTO_SAVE_DEBOUNCE_MS = 350

export interface SettingsDraft {
  draft: Ref<AppSettings>
  flush: () => Promise<void>
}

/**
 * Owns the settings draft lifecycle: adopt external store changes only when
 * the draft carries no unsaved edits, autosave mutations with a debounce, and
 * flush on unmount. Sections mutate the returned draft in place — persistence
 * stays centralized here so section components stay presentational.
 */
export function useSettingsDraft(): SettingsDraft {
  const { t } = useI18n()
  const store = useSettingsStore()

  const draft = ref<AppSettings>({
    language: 'auto',
    theme: 'dark',
    mascotUnlocked: false,
    mascotStyle: DEFAULT_MASCOT_STYLE,
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

  /** Serialized snapshot of what was last persisted, for echo/external-change detection. */
  let lastPersisted = ''
  let adoptingStoreSettings = false
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  onMounted(() => {
    void store.fetch()
  })

  watch(
    () => store.settings,
    (s) => {
      if (!s) return
      const incoming = { ...s, navOrder: normalizeNavOrder(s.navOrder) }
      const serialized = JSON.stringify(incoming)
      if (serialized === JSON.stringify(draft.value)) {
        // Save echo or no-op: record the snapshot, keep any newer local edits.
        lastPersisted = serialized
        return
      }
      // Adopt external changes only when the draft carries no unsaved edits.
      if (lastPersisted !== '' && JSON.stringify(draft.value) !== lastPersisted) return
      lastPersisted = serialized
      adoptingStoreSettings = true
      draft.value = incoming
      void nextTick().then(() => {
        adoptingStoreSettings = false
      })
    },
    { immediate: true }
  )

  watch(
    draft,
    () => {
      if (adoptingStoreSettings) return
      schedulePersist()
    },
    { deep: true }
  )

  async function persistDraft(): Promise<void> {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    const patch: AppSettings = { ...draft.value }
    if (!patch.mascotUnlocked) {
      patch.mascotStyle = DEFAULT_MASCOT_STYLE
    }
    try {
      const saved = await store.patch(patch)
      lastPersisted = JSON.stringify(saved)
    } catch (e) {
      toast.error((e as { message?: string }).message ?? t('common.failed'))
    }
  }

  function schedulePersist(): void {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      void persistDraft()
    }, AUTO_SAVE_DEBOUNCE_MS)
  }

  onBeforeUnmount(() => {
    // Flush a pending autosave immediately when leaving the settings view.
    if (saveTimer) void persistDraft()
  })

  return { draft, flush: persistDraft }
}

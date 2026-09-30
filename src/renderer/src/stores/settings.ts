import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { AppSettings, BackupRecord } from '@shared/ipc/api-types'
import type { CustomSkinDescriptor } from '@shared/types/custom-skin'
import { callApi, getApi } from '@renderer/composables/useApi'
import { i18n, resolveLocale } from '@renderer/i18n'
import { applyTheme } from '@renderer/utils/theme'
import { normalizeAppTheme } from '@shared/constants/theme'
import { normalizeAppIconPreference } from '@shared/constants/app-icon'
import { normalizeMascotStyle } from '@shared/constants/mascot'
import { MASCOT_ENABLED } from '@shared/feature-flags'
import { normalizeNavOrder } from '@shared/constants/navigation'
import { applyVisualSkin } from '@renderer/utils/visual-skin'
import { toIpcSettingsPatch } from '@renderer/utils/settings-patch'
import { setCustomSkinCatalog } from '@renderer/utils/skin-catalog'
import { normalizeAssistantName, normalizeUserName } from '@shared/constants/chat-participants'
import {
  normalizeMacOS27Background,
  normalizeMacOS27BackgroundImage
} from '@shared/constants/macos27-background'

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<AppSettings | null>(null)
  const backups = ref<BackupRecord[]>([])
  const customSkins = ref<CustomSkinDescriptor[]>([])
  const loading = ref(false)
  const backupsLoading = ref(false)
  const error = ref<string | null>(null)

  async function fetch() {
    loading.value = true
    error.value = null
    try {
      const [next, skins] = await Promise.all([
        callApi(() => getApi().settings.get()),
        callApi(() => getApi().skins.list())
      ])
      customSkins.value = skins
      setCustomSkinCatalog(skins)
      normalizeExperienceSettings(next)
      settings.value = next
      applyLocale(settings.value.language)
      applyExperiencePrefs(settings.value)
    } catch (e) {
      error.value = (e as { message?: string }).message ?? String(e)
    } finally {
      loading.value = false
    }
  }

  async function patch(partial: Partial<AppSettings>) {
    settings.value = await callApi(() => getApi().settings.set(toIpcSettingsPatch(partial)))
    normalizeExperienceSettings(settings.value)
    applyLocale(settings.value.language)
    applyExperiencePrefs(settings.value)
    return settings.value
  }

  async function unlockMascot(answer: string): Promise<boolean> {
    if (!MASCOT_ENABLED) return false
    const unlocked = await callApi(() => getApi().settings.unlockMascot(answer))
    if (unlocked && settings.value) settings.value.mascotUnlocked = true
    return unlocked
  }

  async function importCustomSkin(): Promise<CustomSkinDescriptor | null> {
    const imported = await callApi(() => getApi().skins.import())
    if (!imported) return null
    customSkins.value = await callApi(() => getApi().skins.list())
    setCustomSkinCatalog(customSkins.value)
    return imported
  }

  async function createCustomSkinProject() {
    return callApi(() => getApi().skins.createProject())
  }

  function applyLocale(language: AppSettings['language']) {
    i18n.global.locale.value = resolveLocale(language)
  }

  function applyExperiencePrefs(value: AppSettings) {
    applyVisualSkin(value)
    applyTheme(value.theme)
  }

  function normalizeExperienceSettings(value: AppSettings): void {
    value.theme = normalizeAppTheme(value.theme)
    value.macos27Background = normalizeMacOS27Background(value.macos27Background)
    value.macos27BackgroundImage = normalizeMacOS27BackgroundImage(value.macos27BackgroundImage)
    value.userName = normalizeUserName(value.userName)
    value.assistantName = normalizeAssistantName(value.assistantName)
    value.appIcon = normalizeAppIconPreference(value.appIcon)
    value.mascotStyle = normalizeMascotStyle(value.mascotStyle)
    if (value.customSkinId && !customSkins.value.some((skin) => skin.id === value.customSkinId)) {
      value.customSkinId = null
    }
    value.petSleepMinutes = Math.min(120, Math.max(1, value.petSleepMinutes))
    value.navOrder = normalizeNavOrder(value.navOrder)
    if (!MASCOT_ENABLED) {
      // Mascot-free builds ship neither the Settings section nor the assets.
      value.mascotUnlocked = false
      value.mascotStyle = 'none'
      value.customSkinId = null
    } else if (!value.mascotUnlocked) {
      value.mascotStyle = 'none'
    }
  }

  async function fetchBackups() {
    backupsLoading.value = true
    try {
      backups.value = await callApi(() => getApi().backup.list())
    } finally {
      backupsLoading.value = false
    }
  }

  async function createBackup(reason?: string) {
    const record = await callApi(() => getApi().backup.create(reason))
    await fetchBackups()
    return record
  }

  async function restoreBackup(id: string) {
    await callApi(() => getApi().backup.restore(id))
    await fetchBackups()
  }

  async function deleteBackup(id: string) {
    await callApi(() => getApi().backup.delete(id))
    await fetchBackups()
  }

  async function pruneBackups(retention: number) {
    const result = await callApi(() => getApi().backup.pruneToRetention(retention))
    await fetchBackups()
    return result
  }

  async function openBackupFolder() {
    await callApi(() => getApi().backup.openFolder())
  }

  return {
    settings,
    backups,
    customSkins,
    loading,
    backupsLoading,
    error,
    fetch,
    patch,
    unlockMascot,
    importCustomSkin,
    createCustomSkinProject,
    fetchBackups,
    createBackup,
    restoreBackup,
    deleteBackup,
    pruneBackups,
    openBackupFolder
  }
})

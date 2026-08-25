import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { AppSettings, BackupRecord } from '@shared/ipc/api-types'
import { callApi, getApi } from '@renderer/composables/useApi'
import { i18n, resolveLocale } from '@renderer/i18n'
import { watchSystemTheme, applyAccent, type ThemePreference } from '@renderer/utils/theme'
import { normalizeMascotStyle } from '@shared/constants/mascot'

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<AppSettings | null>(null)
  const backups = ref<BackupRecord[]>([])
  const loading = ref(false)
  const backupsLoading = ref(false)
  const error = ref<string | null>(null)

  async function fetch() {
    loading.value = true
    error.value = null
    try {
      const next = await callApi(() => getApi().settings.get())
      // Product default language is zh-CN; migrate bare defaults once.
      if (!next.language) next.language = 'zh-CN'
      next.mascotStyle = normalizeMascotStyle(next.mascotStyle)
      next.aiMotionBorder ??= true
      next.accentColor ??= 'blue'
      next.customAccentColor ??= '#5b91f5'
      normalizePetSettings(next)
      settings.value = next
      applyLocale(settings.value.language)
      applyThemePrefs(settings.value.theme)
      applyAccentPrefs(settings.value)
    } catch (e) {
      error.value = (e as { message?: string }).message ?? String(e)
    } finally {
      loading.value = false
    }
  }

  async function patch(partial: Partial<AppSettings>) {
    settings.value = await callApi(() => getApi().settings.set(partial))
    settings.value.mascotStyle = normalizeMascotStyle(settings.value.mascotStyle)
    normalizePetSettings(settings.value)
    applyLocale(settings.value.language)
    applyThemePrefs(settings.value.theme)
    applyAccentPrefs(settings.value)
    return settings.value
  }

  async function unlockMascot(answer: string): Promise<boolean> {
    const unlocked = await callApi(() => getApi().settings.unlockMascot(answer))
    if (unlocked && settings.value) settings.value.mascotUnlocked = true
    return unlocked
  }

  function applyLocale(language: AppSettings['language']) {
    i18n.global.locale.value = resolveLocale(language)
  }

  function applyThemePrefs(theme: AppSettings['theme']) {
    watchSystemTheme(theme as ThemePreference)
  }

  function applyAccentPrefs(settingsValue: AppSettings): void {
    applyAccent(settingsValue.accentColor, settingsValue.customAccentColor)
  }

  function normalizePetSettings(value: AppSettings): void {
    value.mascotUnlocked ??= false
    value.petEnabled ??= false
    value.petAnimations ??= true
    value.petStatusText ??= true
    value.petAutoSleep ??= true
    value.petSound ??= false
    value.petSleepMinutes = Math.min(120, Math.max(1, value.petSleepMinutes || 10))
    if (!value.mascotUnlocked) {
      value.mascotStyle = 'none'
      value.petEnabled = false
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
    loading,
    backupsLoading,
    error,
    fetch,
    patch,
    unlockMascot,
    fetchBackups,
    createBackup,
    restoreBackup,
    deleteBackup,
    pruneBackups,
    openBackupFolder
  }
})

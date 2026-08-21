import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { AppSettings, BackupRecord } from '@shared/ipc/api-types'
import { callApi, getApi } from '@renderer/composables/useApi'
import { i18n, resolveLocale } from '@renderer/i18n'
import { watchSystemTheme, type ThemePreference } from '@renderer/utils/theme'

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
      settings.value = next
      applyLocale(settings.value.language)
      applyThemePrefs(settings.value.theme)
    } catch (e) {
      error.value = (e as { message?: string }).message ?? String(e)
    } finally {
      loading.value = false
    }
  }

  async function patch(partial: Partial<AppSettings>) {
    settings.value = await callApi(() => getApi().settings.set(partial))
    applyLocale(settings.value.language)
    applyThemePrefs(settings.value.theme)
    return settings.value
  }

  function applyLocale(language: AppSettings['language']) {
    i18n.global.locale.value = resolveLocale(language)
  }

  function applyThemePrefs(theme: AppSettings['theme']) {
    watchSystemTheme(theme as ThemePreference)
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
    fetchBackups,
    createBackup,
    restoreBackup,
    deleteBackup,
    pruneBackups,
    openBackupFolder
  }
})

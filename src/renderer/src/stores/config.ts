import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { RawConfig, ConfigStatus } from '@shared/ipc/api-types'
import { callApi, getApi } from '@renderer/composables/useApi'
import {
  isConfigConflict,
  openConflict,
  type ConflictFile
} from '@renderer/composables/useConfigConflict'

export type ConfigFile = 'models' | 'settings'

export const useConfigStore = defineStore('config', () => {
  const file = ref<ConfigFile>('models')
  const raw = ref<RawConfig | null>(null)
  const draft = ref('')
  const status = ref<ConfigStatus | null>(null)
  const loading = ref(false)
  const saving = ref(false)
  const dirty = ref(false)
  const error = ref<string | null>(null)

  async function load(target: ConfigFile = file.value) {
    loading.value = true
    error.value = null
    file.value = target
    try {
      raw.value = await callApi(() => getApi().config.readRaw(target))
      draft.value = raw.value.content
      dirty.value = false
      status.value = await callApi(() => getApi().config.getStatus())
    } catch (e) {
      error.value = (e as { message?: string }).message ?? String(e)
    } finally {
      loading.value = false
    }
  }

  function setDraft(content: string) {
    draft.value = content
    dirty.value = content !== (raw.value?.content ?? '')
  }

  async function reload() {
    status.value = await callApi(() => getApi().config.reload())
    await load(file.value)
  }

  /**
   * Save the raw editor draft. If main throws CONFIG_CONFLICT, surface the
   * Configuration Conflict Dialog and let the user pick:
   *   - reload:    re-read disk, discard draft
   *   - overwrite: back up current disk, then write draft
   *   - cancel:    keep draft, no-op
   * Throws if validation fails (so the view can show the error inline).
   */
  async function save() {
    saving.value = true
    error.value = null
    // Validate JSON client-side before round-trip
    try {
      JSON.parse(draft.value)
    } catch (e) {
      saving.value = false
      const msg = (e as Error).message
      error.value = msg
      throw new Error(`Invalid JSON: ${msg}`)
    }
    try {
      await callApi(() => getApi().config.writeRaw(file.value, draft.value))
      await load(file.value)
    } catch (e) {
      const payload = e as { code?: string; message?: string; details?: unknown }
      if (isConfigConflict(payload)) {
        const resolution = await openConflict(file.value, await snapshot(file.value), {
          source: 'raw-edit'
        })
        if (resolution === 'cancel') {
          error.value = 'Save cancelled — disk version differs.'
          return
        }
        if (resolution === 'reload') {
          await reload()
          return
        }
        // overwrite — retry with the flag set; main backs up before writing.
        try {
          await callApi(() =>
            getApi().config.writeRaw(file.value, draft.value, { overwrite: true })
          )
          await load(file.value)
        } catch (inner) {
          error.value = (inner as { message?: string }).message ?? String(inner)
          throw inner
        }
        return
      }
      error.value = payload.message ?? String(e)
      throw e
    } finally {
      saving.value = false
    }
  }

  async function snapshot(target: ConflictFile) {
    return callApi(() => getApi().config.conflictSnapshot(target))
  }

  return {
    file,
    raw,
    draft,
    status,
    loading,
    saving,
    dirty,
    error,
    load,
    setDraft,
    save,
    reload,
    snapshot
  }
})

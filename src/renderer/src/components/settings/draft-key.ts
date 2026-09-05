import type { InjectionKey, Ref } from 'vue'
import type { AppSettings } from '@shared/ipc/api-types'

/**
 * The settings view owns one autosaved draft (`useSettingsDraft`) and provides
 * it to every section below it. Sections mutate the draft in place; the view
 * stays the single owner of persistence.
 */
export const SETTINGS_DRAFT_KEY: InjectionKey<Ref<AppSettings>> = Symbol('settings-draft')

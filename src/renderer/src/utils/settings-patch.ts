import { toRaw } from 'vue'
import type { AppSettings } from '@shared/ipc/api-types'
import { normalizeNavOrder } from '@shared/constants/navigation'

/** Vue reactive proxies cannot be structured-cloned across Electron IPC. */
export function toIpcSettingsPatch(partial: Partial<AppSettings>): Partial<AppSettings> {
  const cloned = JSON.parse(JSON.stringify(toRaw(partial))) as Partial<AppSettings>
  if (cloned.navOrder) cloned.navOrder = normalizeNavOrder(cloned.navOrder)
  return cloned
}

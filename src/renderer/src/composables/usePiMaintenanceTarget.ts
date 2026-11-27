import { readonly, ref } from 'vue'
import type { PiTerminalInstallation } from '@shared/ipc/api-types'
import type { PiMaintenanceTarget } from '@shared/runtime/schema'
import { getApi } from './useApi'

type PiMaintenanceAction = 'update' | 'reinstall'

const pending = ref(false)
const selection = ref<{ action: PiMaintenanceAction; terminal: PiTerminalInstallation } | null>(
  null
)
let resolveTarget: ((target: PiMaintenanceTarget | null) => void) | undefined

export const piMaintenancePending = readonly(pending)
export const piMaintenanceSelection = readonly(selection)

export async function choosePiMaintenanceTarget(
  action: PiMaintenanceAction
): Promise<PiMaintenanceTarget | null> {
  if (pending.value) return null
  pending.value = true
  try {
    const terminal = await getApi().pi.getTerminalInstallation()
    if (!terminal) return 'bundled'
    return await new Promise((resolve) => {
      resolveTarget = resolve
      selection.value = { action, terminal }
    })
  } finally {
    pending.value = false
  }
}

export function resolvePiMaintenanceTarget(target: PiMaintenanceTarget | null): void {
  const resolve = resolveTarget
  resolveTarget = undefined
  selection.value = null
  resolve?.(target)
}

/**
 * Global confirm dialog — promise-based, mounted once via <ConfirmDialog />.
 * Use for any destructive / irreversible action (delete, restore, overwrite, install…).
 */

import { reactive, readonly } from 'vue'

export type ConfirmTone = 'danger' | 'primary'

export interface ConfirmOptions {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: ConfirmTone
}

interface ConfirmState {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  cancelLabel: string
  tone: ConfirmTone
  pending: { resolve: (ok: boolean) => void } | null
}

const state = reactive<ConfirmState>({
  open: false,
  title: '',
  description: '',
  confirmLabel: '',
  cancelLabel: '',
  tone: 'danger',
  pending: null
})

export function askConfirm(options: ConfirmOptions): Promise<boolean> {
  if (state.open && state.pending) {
    state.pending.resolve(false)
  }
  state.title = options.title
  state.description = options.description ?? ''
  state.confirmLabel = options.confirmLabel ?? ''
  state.cancelLabel = options.cancelLabel ?? ''
  state.tone = options.tone ?? 'danger'
  state.open = true
  return new Promise<boolean>((resolve) => {
    state.pending = { resolve }
  })
}

export function resolveConfirm(ok: boolean): void {
  if (!state.pending) {
    state.open = false
    return
  }
  const p = state.pending
  state.pending = null
  state.open = false
  p.resolve(ok)
}

export function useConfirmDialog() {
  return {
    state: readonly(state),
    askConfirm,
    resolveConfirm
  }
}

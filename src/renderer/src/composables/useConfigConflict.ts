/**
 * useConfigConflict — unified handler for CONFIG_CONFLICT errors.
 *
 * Every write path (provider/model/raw config/skill/restore) that catches a
 * CONFIG_CONFLICT AppErrorPayload should call `openConflict(payload, ctx)`:
 *   - it lifts the conflict into a global reactive state
 *   - the <ConflictDialog /> mounts at app shell level and renders the snapshot
 *   - the caller awaits `resolve()` which resolves to the user's choice
 *
 * Resolution actions:
 *   - 'reload':   discard Pi-Harness edits, re-read disk, re-render
 *   - 'overwrite': back up current disk and write Pi-Harness's version
 *   - 'cancel':   keep current editor state, no-op
 *
 * Compare is handled inside the dialog without resolving — the caller can keep
 * its pending promise open while the user inspects the diff.
 */

import { reactive, readonly } from 'vue'
import type { AppErrorPayload } from '@shared/types/errors'
import type { ConfigConflictSnapshot } from '@shared/ipc/api-types'

export type ConflictFile = 'models' | 'settings'

export interface ConflictContext {
  /** A short tag (e.g. 'provider-save', 'raw-save', 'set-active') for diagnostics. */
  source: string
  /** Optional display label for the dialog header. */
  label?: string
}

export type ConflictResolution = 'reload' | 'overwrite' | 'cancel'

interface ConflictState {
  open: boolean
  file: ConflictFile
  snapshot: ConfigConflictSnapshot | null
  context: ConflictContext
  pending: {
    resolve: (r: ConflictResolution) => void
  } | null
}

const state = reactive<ConflictState>({
  open: false,
  file: 'models',
  snapshot: null,
  context: { source: '' },
  pending: null
})

/**
 * Detect a CONFIG_CONFLICT payload from an IPC error envelope.
 */
export function isConfigConflict(
  err: unknown
): err is AppErrorPayload & { code: 'CONFIG_CONFLICT' } {
  if (!err || typeof err !== 'object') return false
  const code = (err as { code?: unknown }).code
  return code === 'CONFIG_CONFLICT'
}

/**
 * Open the conflict dialog and wait for the user's resolution.
 *
 * The caller should pass the original error payload (so the dialog can show
 * the original message) AND the file that conflicted AND the snapshot fetched
 * from main via `api.config.conflictSnapshot(file)`.
 */
export function openConflict(
  file: ConflictFile,
  snapshot: ConfigConflictSnapshot,
  context: ConflictContext
): Promise<ConflictResolution> {
  // If a conflict is already open, resolve the previous one as cancel first
  // so we don't strand the previous caller.
  if (state.open && state.pending) {
    state.pending.resolve('cancel')
  }
  state.file = file
  state.snapshot = snapshot
  state.context = context
  state.open = true
  return new Promise<ConflictResolution>((resolve) => {
    state.pending = { resolve }
  })
}

/**
 * Called by ConflictDialog when the user picks an action.
 */
export function resolveConflict(resolution: ConflictResolution): void {
  if (!state.pending) {
    state.open = false
    state.snapshot = null
    return
  }
  const p = state.pending
  state.pending = null
  state.open = false
  // Keep snapshot briefly in case the dialog is still animating closed.
  // It's overwritten on the next openConflict().
  p.resolve(resolution)
}

export function useConfigConflict() {
  return {
    state: readonly(state),
    isConfigConflict,
    openConflict,
    resolveConflict
  }
}

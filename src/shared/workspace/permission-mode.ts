/** Tool approval modes, enforced by the desktop extension for every tool call. */
export const PERMISSION_MODES = ['ask', 'accept-edits', 'auto'] as const
export type PermissionMode = (typeof PERMISSION_MODES)[number]

/** Tools that never require approval: read-only inspection is always safe. */
export const PERMISSION_READ_ONLY_TOOLS = new Set(['read', 'grep', 'find', 'ls'])

/** Tools covered by the looser "accept edits" tier besides read-only passes. */
export const PERMISSION_EDIT_TOOLS = new Set(['write', 'edit'])

export function isPermissionMode(value: unknown): value is PermissionMode {
  return typeof value === 'string' && (PERMISSION_MODES as readonly string[]).includes(value)
}

export function normalizePermissionMode(value: unknown): PermissionMode {
  return isPermissionMode(value) ? value : 'auto'
}

/**
 * Whether a tool call needs the user's approval under a mode.
 *
 * - `ask`: every non-read-only tool waits for an explicit approval.
 * - `accept-edits`: file edits run without asking; commands and other tools ask.
 * - `auto`: everything runs (today's default behavior).
 */
export function toolNeedsApproval(toolName: string, mode: PermissionMode): boolean {
  if (PERMISSION_READ_ONLY_TOOLS.has(toolName)) return false
  if (mode === 'auto') return false
  if (mode === 'accept-edits') return !PERMISSION_EDIT_TOOLS.has(toolName)
  return true
}

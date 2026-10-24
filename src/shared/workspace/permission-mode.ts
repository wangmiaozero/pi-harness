/** Tool approval modes, enforced by the desktop extension for every tool call. */
export const PERMISSION_MODES = ['ask', 'accept-edits', 'auto'] as const
export type PermissionMode = (typeof PERMISSION_MODES)[number]

/** Tools that never require approval: read-only inspection is always safe. */
export const PERMISSION_READ_ONLY_TOOLS = new Set(['read', 'grep', 'find', 'ls'])

/** Built-in tools whose file/network/command risks are evaluated by the host. */
const HOST_GUARDED_TOOLS = new Set(['write', 'edit', 'bash', 'powershell'])

export function isPermissionMode(value: unknown): value is PermissionMode {
  return typeof value === 'string' && (PERMISSION_MODES as readonly string[]).includes(value)
}

export function normalizePermissionMode(value: unknown): PermissionMode {
  return isPermissionMode(value) ? value : 'auto'
}

/**
 * Whether a tool call needs the user's approval under a mode.
 *
 * The persisted mode names remain compatible with earlier installations.
 * Built-in file/command tools use the host policy guard; this fallback applies
 * to tools whose risks the host cannot classify.
 */
export function toolNeedsApproval(toolName: string, mode: PermissionMode): boolean {
  if (PERMISSION_READ_ONLY_TOOLS.has(toolName)) return false
  if (mode === 'auto') return false
  if (HOST_GUARDED_TOOLS.has(toolName)) return false
  return true
}

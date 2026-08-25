/**
 * Unified error system.
 *
 * Errors are serialised across the IPC boundary as a plain AppErrorPayload.
 * The main process constructs typed errors internally; the renderer receives
 * the serialised payload and maps it back to user-readable messages.
 */

export type AppErrorCode =
  | 'APP_ERROR'
  | 'PI_CLI_ERROR'
  | 'PI_CLI_MISSING'
  | 'NODE_NOT_FOUND'
  | 'NODE_VERSION_TOO_LOW'
  | 'NODE_DOWNLOAD_FAILED'
  | 'NODE_INSTALL_FAILED'
  | 'NPM_NOT_FOUND'
  | 'NPM_PERMISSION_DENIED'
  | 'NPM_INSTALL_FAILED'
  | 'PI_NOT_FOUND_AFTER_INSTALL'
  | 'PATH_NOT_REFRESHED'
  | 'COMMAND_FAILED'
  | 'INSTALL_CANCELLED'
  | 'CONFIG_ERROR'
  | 'CONFIG_PARSE_ERROR'
  | 'CONFIG_CONFLICT'
  | 'SKILL_CONFLICT'
  | 'SKILL_NOT_FOUND'
  | 'SKILL_ALREADY_INSTALLED'
  | 'SKILL_INSTALL_FAILED'
  | 'SKILL_INVALID'
  | 'SKILL_PATH_INVALID'
  | 'SKILL_PERMISSION_DENIED'
  | 'PACKAGE_HEALTH_ERROR'
  | 'PROCESS_FAILED'
  | 'CONFIG_NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'FILE_SYSTEM_ERROR'
  | 'FILE_CONFLICT'
  | 'NETWORK_ERROR'
  | 'AUTHENTICATION_ERROR'
  | 'PROTOCOL_ERROR'
  | 'BACKUP_ERROR'
  | 'SECURITY_ERROR'
  | 'NOT_FOUND'
  | 'IPC_ERROR'
  | 'AGENT_ERROR'
  | 'SESSION_ERROR'
  | 'GIT_ERROR'
  | 'PATH_DENIED'

export interface AppErrorPayload {
  code: AppErrorCode
  message: string
  /** Safe, end-user-facing fallback. Defaults to `message` for legacy errors. */
  userMessage?: string
  /** Whether retry/repair can reasonably succeed without changing user data. */
  recoverable?: boolean
  /** Structured, sanitised diagnostic context. `details` remains for compatibility. */
  context?: unknown
  /** Technical details (sanitised — never contains secrets). */
  details?: unknown
  cause?: AppErrorPayload
}

export const isErrorPayload = (v: unknown): v is AppErrorPayload =>
  typeof v === 'object' &&
  v !== null &&
  'code' in v &&
  typeof (v as { code: unknown }).code === 'string' &&
  'message' in v &&
  typeof (v as { message: unknown }).message === 'string'

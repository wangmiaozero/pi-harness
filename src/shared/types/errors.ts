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
  | 'CONFIG_ERROR'
  | 'CONFIG_PARSE_ERROR'
  | 'CONFIG_CONFLICT'
  | 'SKILL_CONFLICT'
  | 'CONFIG_NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'FILE_SYSTEM_ERROR'
  | 'NETWORK_ERROR'
  | 'AUTHENTICATION_ERROR'
  | 'PROTOCOL_ERROR'
  | 'BACKUP_ERROR'
  | 'SECURITY_ERROR'
  | 'NOT_FOUND'
  | 'IPC_ERROR'

export interface AppErrorPayload {
  code: AppErrorCode
  message: string
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

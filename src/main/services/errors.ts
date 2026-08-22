/**
 * Typed application error hierarchy. Each error serialises to an
 * AppErrorPayload that crosses the IPC boundary safely (and never carries
 * raw secrets — message/details are constructed from sanitised values).
 */

import type { AppErrorPayload, AppErrorCode } from '@shared/types/errors'
import { redactSecrets, redactSecretText } from './logger'

export class AppError extends Error {
  readonly code: AppErrorCode
  readonly details?: unknown
  readonly cause?: AppError

  constructor(code: AppErrorCode, message: string, details?: unknown, cause?: AppError) {
    super(message)
    this.name = this.constructor.name
    this.code = code
    this.details = details
    this.cause = cause
  }

  toPayload(): AppErrorPayload {
    const payload: AppErrorPayload = {
      code: this.code,
      message: this.message,
      details: this.details
    }
    if (this.cause) payload.cause = this.cause.toPayload()
    return payload
  }
}

export class PiCliError extends AppError {
  constructor(message: string, details?: unknown) {
    super('PI_CLI_ERROR', message, details)
  }
}

export class PiCliMissingError extends AppError {
  constructor(message = 'Pi Coding Agent CLI not found', details?: unknown) {
    super('PI_CLI_MISSING', message, details)
  }
}

export class ConfigError extends AppError {
  constructor(message: string, details?: unknown) {
    super('CONFIG_ERROR', message, details)
  }
}

export class ConfigParseError extends AppError {
  constructor(message: string, details?: unknown) {
    super('CONFIG_PARSE_ERROR', message, details)
  }
}

export class ConfigConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super('CONFIG_CONFLICT', message, details)
  }
}

export class SkillConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super('SKILL_CONFLICT', message, details)
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super('VALIDATION_ERROR', formatValidationMessage(message, details), details)
  }
}

function formatValidationMessage(message: string, details?: unknown): string {
  const issues = (
    details as { issues?: Array<{ path?: Array<string | number>; message?: string }> } | undefined
  )?.issues
  if (!issues?.length) return message
  const parts = issues
    .map((i) => {
      const path = i.path?.length ? i.path.join('.') : ''
      const msg = i.message ?? ''
      if (!msg) return path
      return path ? `${path}: ${msg}` : msg
    })
    .filter(Boolean)
  return parts.length ? `${message} (${parts.join('; ')})` : message
}

export class FileSystemError extends AppError {
  constructor(message: string, details?: unknown) {
    super('FILE_SYSTEM_ERROR', message, details)
  }
}

export class FileConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super('FILE_CONFLICT', message, details)
  }
}

export class NetworkError extends AppError {
  constructor(message: string, details?: unknown) {
    super('NETWORK_ERROR', message, details)
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string, details?: unknown) {
    super('AUTHENTICATION_ERROR', message, details)
  }
}

export class ProtocolError extends AppError {
  constructor(message: string, details?: unknown) {
    super('PROTOCOL_ERROR', message, details)
  }
}

export class BackupError extends AppError {
  constructor(message: string, details?: unknown) {
    super('BACKUP_ERROR', message, details)
  }
}

export class SecurityError extends AppError {
  constructor(message: string, details?: unknown) {
    super('SECURITY_ERROR', message, details)
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, details?: unknown) {
    super('NOT_FOUND', message, details)
  }
}

export class AgentError extends AppError {
  constructor(message: string, details?: unknown) {
    super('AGENT_ERROR', message, details)
  }
}

export class SessionError extends AppError {
  constructor(message: string, details?: unknown) {
    super('SESSION_ERROR', message, details)
  }
}

export class GitError extends AppError {
  constructor(message: string, details?: unknown) {
    super('GIT_ERROR', message, details)
  }
}

export class PathDeniedError extends AppError {
  constructor(message = 'Path is outside the allowed workspace roots', details?: unknown) {
    super('PATH_DENIED', message, details)
  }
}

/** Convert any thrown value into an AppErrorPayload (lossless + secret-free). */
export function toErrorPayload(err: unknown): AppErrorPayload {
  if (err instanceof AppError) return redactErrorPayload(err.toPayload())
  if (err instanceof Error) {
    return {
      code: 'APP_ERROR',
      message: redactSecretText(err.message),
      details: { name: err.name }
    }
  }
  return {
    code: 'APP_ERROR',
    message: 'Unknown error',
    details: { raw: redactSecretText(String(err)) }
  }
}

function redactErrorPayload(payload: AppErrorPayload): AppErrorPayload {
  return {
    ...payload,
    message: redactSecretText(payload.message),
    details: redactSecrets(payload.details),
    ...(payload.cause ? { cause: redactErrorPayload(payload.cause) } : {})
  }
}

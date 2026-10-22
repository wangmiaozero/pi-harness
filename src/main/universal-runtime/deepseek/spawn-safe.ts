/**
 * Safe subprocess helpers for the DeepSeek Harness runtime.
 *
 * Security rules (mirroring the repo-wide Windows installation boundary):
 * - No shell string concatenation of user data; argv arrays only.
 * - Windows `.cmd`/`.bat` shims execute through `ComSpec` with an argument
 *   array, never through a shell string.
 * - stdout is protocol traffic only; stderr is redacted diagnostics.
 */

import { spawn } from 'node:child_process'
import { redactSecretText } from '../../services/logger'

export interface SafeSpawnResult {
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

/** True when the executable needs the Windows `ComSpec` shim path. */
export function isWindowsScriptShim(executablePath: string): boolean {
  return process.platform === 'win32' && /\.(cmd|bat)$/i.test(executablePath)
}

export interface SafeSpawnOptions {
  command: string
  args: readonly string[]
  cwd?: string
  env?: Record<string, string>
  timeoutMs?: number
  /** Max buffered stdout/stderr characters per stream. */
  maxBufferChars?: number
}

/**
 * Spawn an executable without a shell. Returns collected (and for stderr,
 * redacted) output. Never throws for non-zero exit; only for spawn failure or
 * invalid input.
 */
export function safeSpawn(options: SafeSpawnOptions): Promise<SafeSpawnResult> {
  const { command, args } = options
  if (typeof command !== 'string' || !command.trim()) {
    return Promise.reject(new Error('Empty executable path'))
  }
  const useComSpec = isWindowsScriptShim(command)
  const finalCommand = useComSpec ? (process.env.ComSpec ?? 'cmd.exe') : command
  const finalArgs = useComSpec ? ['/d', '/s', '/c', command, ...args] : [...args]
  const maxChars = options.maxBufferChars ?? 200_000

  return new Promise<SafeSpawnResult>((resolve, reject) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(finalCommand, finalArgs, {
        ...(options.cwd ? { cwd: options.cwd } : {}),
        ...(options.env ? { env: options.env } : {}),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsVerbatimArguments: false,
        windowsHide: true
      })
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)))
      return
    }

    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true
          child.kill('SIGKILL')
        }, options.timeoutMs)
      : null

    const finish = (exitCode: number | null): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve({ exitCode, stdout, stderr: redactSecretText(stderr), timedOut })
    }

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      if (stdout.length < maxChars) stdout += chunk
    })
    child.stderr?.on('data', (chunk: string) => {
      if (stderr.length < maxChars) stderr += chunk
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => finish(code))
  })
}

import { spawn } from 'node:child_process'
import path from 'node:path'
import { EnvironmentError } from '../services/errors'

export interface CommandRunResult {
  stdout: string
  stderr: string
  exitCode: number
  signal: NodeJS.Signals | null
}

export interface CommandRunOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  signal?: AbortSignal
  onStdout?: (chunk: string) => void
  onStderr?: (chunk: string) => void
}

export function runCommand(
  executable: string,
  args: string[],
  options: CommandRunOptions = {}
): Promise<CommandRunResult> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new EnvironmentError('INSTALL_CANCELLED', 'Installation was cancelled'))
      return
    }
    const isWindowsShim = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(executable)
    const file = isWindowsShim ? (process.env.ComSpec ?? 'cmd.exe') : executable
    const fileArgs = isWindowsShim ? ['/d', '/s', '/c', executable, ...args] : args
    const child = spawn(file, fileArgs, {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...options.env,
        PATH: mergePath(options.env?.PATH, path.dirname(executable), process.env.PATH)
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timeout = options.timeoutMs
      ? setTimeout(() => {
          child.kill('SIGTERM')
          finishReject(
            new EnvironmentError(
              'COMMAND_FAILED',
              `Command timed out after ${options.timeoutMs}ms`,
              { executable, args }
            )
          )
        }, options.timeoutMs)
      : null

    const onAbort = () => {
      child.kill('SIGTERM')
      finishReject(new EnvironmentError('INSTALL_CANCELLED', 'Installation was cancelled'))
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })

    child.stdout.on('data', (data: Buffer | string) => {
      const chunk = sanitize(String(data))
      stdout += chunk
      options.onStdout?.(chunk)
    })
    child.stderr.on('data', (data: Buffer | string) => {
      const chunk = sanitize(String(data))
      stderr += chunk
      options.onStderr?.(chunk)
    })
    child.once('error', (error) => {
      finishReject(
        new EnvironmentError('COMMAND_FAILED', `Failed to start ${path.basename(executable)}`, {
          code: (error as NodeJS.ErrnoException).code,
          message: error.message
        })
      )
    })
    child.once('close', (code, childSignal) => {
      if (settled) return
      settled = true
      cleanup()
      resolve({ stdout, stderr, exitCode: code ?? 1, signal: childSignal })
    })

    function finishReject(error: Error): void {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }

    function cleanup(): void {
      if (timeout) clearTimeout(timeout)
      options.signal?.removeEventListener('abort', onAbort)
    }
  })
}

export function displayCommand(executable: string, args: string[]): string {
  return [path.basename(executable), ...args]
    .map((value) => (/^[a-zA-Z0-9@/._:=+-]+$/.test(value) ? value : JSON.stringify(value)))
    .join(' ')
}

function mergePath(...values: Array<string | null | undefined>): string {
  const seen = new Set<string>()
  const entries: string[] = []
  for (const value of values) {
    for (const entry of (value ?? '').split(path.delimiter).filter(Boolean)) {
      const identity = process.platform === 'win32' ? entry.toLowerCase() : entry
      if (seen.has(identity)) continue
      seen.add(identity)
      entries.push(entry)
    }
  }
  return entries.join(path.delimiter)
}

function sanitize(value: string): string {
  return value.replace(/(?:sk-[a-zA-Z0-9-]{6,}|Bearer\s+[^\s]+)/gi, '[redacted]')
}

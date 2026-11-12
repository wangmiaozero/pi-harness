import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { LocalAccount } from '@shared/providers/account-management'
import { resolveExecutable, resolveLoginShellPath } from '../environment/command-resolver'

const exec = promisify(execFile)
const sources = ['codex', 'claude', 'gemini'] as const
type Source = (typeof sources)[number]

export function parseAccountStatus(
  source: 'codex' | 'claude',
  code: number,
  output: string
): LocalAccount {
  if (source === 'codex') {
    if (code === 0 && /^logged in using chatgpt\b/i.test(output.trim()))
      return { source, status: 'detected', authentication: 'subscription' }
    if (
      code === 0 &&
      /^(?:logged in using (?:an? )?api key|api key configured)\b/i.test(output.trim())
    )
      return { source, status: 'detected', authentication: 'apiKey' }
    if (code === 0 && /^logged in using /i.test(output.trim()))
      return { source, status: 'detected', authentication: 'other' }
    if (code === 1 && /^not logged in\b/i.test(output.trim()))
      return { source, status: 'signedOut' }
  } else {
    try {
      const payload = JSON.parse(output)
      if (code === 1 && payload?.loggedIn === false) return { source, status: 'signedOut' }
      if (code === 0 && payload?.loggedIn === true) {
        const method = payload.authMethod
        return {
          source,
          status: 'detected',
          authentication:
            method === 'claude.ai' ? 'subscription' : method === 'api_key' ? 'apiKey' : 'other'
        }
      }
    } catch {
      // Unsupported CLI versions may print human-readable help.
    }
  }
  return { source, status: 'failed' }
}

export class LocalAccountDiscovery {
  private readonly shutdown = new AbortController()
  private pending: Promise<LocalAccount[]> | null = null
  private cached: { value: LocalAccount[]; at: number } | null = null

  constructor(
    private readonly resolve = resolveExecutable,
    private readonly run = exec,
    private readonly resolveShellPath = resolveLoginShellPath
  ) {}

  list(refresh = false): Promise<LocalAccount[]> {
    if (this.pending) return this.pending
    if (!refresh && this.cached && Date.now() - this.cached.at < 60_000)
      return Promise.resolve(this.cached.value)
    const home = homedir()
    let shellPath: Promise<string | null> | undefined
    const getShellPath = () =>
      (shellPath ??=
        process.platform === 'win32'
          ? Promise.resolve(null)
          : this.resolveShellPath({ cwd: home })
              .then(({ path }) => path)
              .catch(() => null))
    this.pending = Promise.all(sources.map((source) => this.detect(source, home, getShellPath)))
      .then((value) => {
        this.cached = { value, at: Date.now() }
        return value
      })
      .finally(() => {
        this.pending = null
      })
    return this.pending
  }

  close(): void {
    this.shutdown.abort()
  }

  private async detect(
    source: Source,
    home: string,
    getShellPath: () => Promise<string | null>
  ): Promise<LocalAccount> {
    if (process.env.PI_HARNESS_DISABLE_ACCOUNT_DISCOVERY === '1')
      return { source, status: 'unsupported' }
    try {
      const cleanPath = (value: string) =>
        value
          .split(path.delimiter)
          .filter((entry) => path.isAbsolute(entry))
          .join(path.delimiter)
      let env = { ...process.env, PATH: cleanPath(process.env.PATH ?? '') }
      const options = {
        cwd: home,
        loginShell: false,
        requireVersion: true,
        additionalDirectories: [
        path.join(home, '.local', 'bin'),
        path.join(home, 'bin'),
        path.join(home, '.npm-global', 'bin'),
        path.join(home, '.pnpm', 'bin'),
        path.join(home, '.volta', 'bin'),
        path.join(home, '.local', 'share', 'mise', 'shims'),
        path.join(home, '.fnm', 'aliases', 'default', 'bin'),
          ...(process.platform === 'darwin' ? ['/opt/homebrew/bin', '/usr/local/bin'] : []),
          ...(process.platform === 'win32' && process.env.APPDATA
            ? [path.join(process.env.APPDATA, 'npm')]
            : [])
        ]
      }
      let binary = await this.resolve(source, { ...options, env })
      if (!binary.found || !binary.path) {
        const inherited = await getShellPath()
        this.shutdown.signal.throwIfAborted()
        if (inherited) {
          env = { ...env, PATH: cleanPath(inherited + path.delimiter + env.PATH) }
          binary = await this.resolve(source, { ...options, env })
        }
      }
      if (!binary.found || !binary.path) return { source, status: 'missing' }
      if (source === 'gemini') return { source, status: 'unsupported' }

      const isShim = process.platform === 'win32' && /\.(cmd|bat)$/i.test(binary.path)
      if (isShim && /[\r\n"%!&|<>^()]/.test(binary.path)) return { source, status: 'unsupported' }
      const args = source === 'codex' ? ['login', 'status'] : ['auth', 'status']
      const program = isShim ? (process.env.ComSpec ?? 'cmd.exe') : binary.path
      const argv = isShim ? ['/d', '/s', '/c', '@', binary.path, ...args] : args
      const invocation = {
        cwd: home,
        env,
        windowsHide: true,
        maxBuffer: 64 * 1024,
        timeout: 5_000,
        signal: this.shutdown.signal,
        encoding: 'utf8' as const
      }
      const { code, stdout, stderr } = await this.run(program, argv, invocation)
        .then((result) => ({ code: 0, ...result }))
        .catch((error: { code?: number; stdout?: string; stderr?: string }) => ({
          code: error.code === 1 ? 1 : -1,
          stdout: error.stdout ?? '',
          stderr: error.stderr ?? ''
        }))
      const status = parseAccountStatus(source, code, stdout)
      return status.status === 'failed' ? parseAccountStatus(source, code, stderr) : status
    } catch {
      return { source, status: 'failed' }
    }
  }
}

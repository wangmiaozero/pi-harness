import { catalog } from './distribution.mjs'
import { binaryIdentity } from './binary-identity.mjs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import semver from 'semver'
import type { ResolvedRuntime, RuntimeKind, RuntimeSource } from '@shared/runtime/schema'
import { buildRuntimeEnvironment } from './environment'
import { log } from '../services/logger'

const exec = promisify(execFile)
export async function probe(
  executable: string,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<string> {
  const started = performance.now()
  try {
    const pending = exec(executable, args, {
      // Metadata checks must not inspect the application's inherited project.
      cwd: path.dirname(executable),
      env: { ...env, NODE_OPTIONS: undefined },
      shell: false,
      windowsHide: true,
      timeout: 15_000,
      maxBuffer: 1024 * 1024
    })
    pending.child.stdin?.end()
    const { stdout } = await pending
    return stdout.trim()
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & {
      signal?: string
      killed?: boolean
      stdout?: string
      stderr?: string
    }
    const reason = failure.killed ? 'timeout' : (failure.code ?? failure.signal ?? 'process exit')
    log.pi.warn('Runtime version probe failed', {
      executable: path.basename(executable),
      elapsedMs: Math.round(performance.now() - started),
      reason,
      signal: failure.signal,
      stdoutBytes: Buffer.byteLength(failure.stdout ?? ''),
      stderrBytes: Buffer.byteLength(failure.stderr ?? '')
    })
    throw new Error(`Runtime version probe failed (${reason})`, { cause: error })
  }
}

export { binaryIdentity } from './binary-identity.mjs'

export async function validateExecutable(
  kind: RuntimeKind,
  source: RuntimeSource,
  file: string | null,
  base: NodeJS.ProcessEnv = process.env
): Promise<ResolvedRuntime> {
  const result: ResolvedRuntime = {
    source,
    executablePath: file,
    version: null,
    platform: process.platform,
    arch: process.arch,
    valid: false,
    integrity: source === 'bundled' ? 'failed' : 'unmanaged',
    diagnosticMessages: []
  }
  let stage = 'path'
  try {
    if (!file || !path.isAbsolute(file) || /[\0\r\n]/.test(file))
      throw new Error('Choose an absolute executable path')
    const real = await fs.realpath(file)
    const stat = await fs.stat(real)
    if (!stat.isFile()) throw new Error('Runtime path is not a file')
    await fs.access(real, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK)
    if (
      kind === 'node' &&
      ((real === process.execPath && process.versions.electron) ||
        /electron(?:\.exe)?$/i.test(real))
    )
      throw new Error('Electron cannot be used as an external Node runtime')
    stage = 'identity'
    const identity = await binaryIdentity(real)
    if (identity && (identity.platform !== process.platform || identity.arch !== process.arch))
      throw new Error('Runtime platform or CPU architecture does not match this application')
    if (kind === 'node' && !identity) throw new Error('Select the native Node executable')
    if (source === 'bundled' && !identity)
      throw new Error('Bundled Pi must be a standalone executable')
    if (/\.(cmd|bat)$/i.test(real))
      throw new Error('Select pi.exe or the npm package cli.js entry instead of a shell shim')
    const env = buildRuntimeEnvironment(base, kind === 'node' ? real : null, 'pi')
    stage = 'version'
    let version: string
    if (kind === 'node') {
      const data = JSON.parse(
        await probe(
          real,
          [
            '-p',
            'JSON.stringify({version:process.version,platform:process.platform,arch:process.arch,electron:process.versions.electron})'
          ],
          env
        )
      )
      if (data.electron || data.platform !== process.platform || data.arch !== process.arch)
        throw new Error('Node runtime identity mismatch')
      version = semver.valid(data.version) ?? ''
      if (!version || semver.lt(version, '22.19.0'))
        throw new Error('Node.js 22.19.0 or newer is required for tools')
    } else {
      // npm Pi entries are validated by the manager using the selected external Node.
      if (/\.[cm]?js$/i.test(real))
        throw new Error('Pi JavaScript entry requires the selected Node runtime')
      version =
        semver.valid((await probe(real, ['--version'], env)).match(/\d+\.\d+\.\d+/)?.[0]) ?? ''
      if (version !== catalog.pi.version)
        throw new Error(
          `This integration is verified with Pi ${catalog.pi.version}; select a compatible runtime`
        )
    }
    result.executablePath = real
    result.version = version
    result.valid = true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    result.diagnosticMessages.push(
      code ? `Runtime verification failed during ${stage} (${code})` : (error as Error).message
    )
  }
  return result
}

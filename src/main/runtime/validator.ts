import { catalog } from './distribution.mjs'
import { binaryIdentity } from './binary-identity.mjs'
import fs from 'node:fs/promises'
import path from 'node:path'
import semver from 'semver'
import type { ResolvedRuntime, RuntimeKind, RuntimeSource } from '@shared/runtime/schema'
import { buildRuntimeEnvironment } from './environment'
import { probe } from './version-probe'
import { assessNodeSecurity } from '@shared/runtime/node-security-policy.mjs'

export { probe } from './version-probe'

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
            'JSON.stringify({version:process.version,platform:process.platform,arch:process.arch,electron:process.versions.electron,compatible:typeof fetch==="function"&&typeof structuredClone==="function"&&typeof AbortSignal.any==="function"&&typeof require("node:fs").promises.cp==="function"&&typeof require("node:stream").Readable.fromWeb==="function"&&typeof require("node:worker_threads").Worker==="function"})'
          ],
          env
        )
      )
      if (data.electron || data.platform !== process.platform || data.arch !== process.arch)
        throw new Error('Node runtime identity mismatch')
      version = semver.valid(data.version) ?? ''
      result.version = version || null
      result.security = assessNodeSecurity(version)
      if (!result.security.executionAllowed)
        throw new Error(`${result.security.reason} ${result.security.remediation}`)
      if (semver.major(version) === 26 && data.compatible !== true)
        throw new Error('This Node.js runtime does not provide the required compatible tool APIs')
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

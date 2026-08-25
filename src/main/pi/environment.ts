/**
 * PiEnvironmentService — startup Pi Coding Agent detection.
 *
 * Cross-platform: resolves the CLI via PiProcessService, locates the config
 * directory, derives the native file paths, scans skill directories, and
 * validates the existing config. Never assumes macOS-only locations.
 */

import path from 'node:path'
import fs from 'node:fs/promises'
import { homedir } from 'node:os'
import { piProcess } from '../process/pi-process'
import { getPiConfigDir, getDefaultSkillDirs, expandHome } from '../services/app-paths'
import { PI_FILES } from '@shared/constants/index'
import { readTextFile, fileMtime } from '../services/storage'
import { piModelsConfigSchema, piSettingsConfigSchema } from '@shared/schemas/pi'
import { log } from '../services/logger'
import type { EnvironmentCheckResult, NodeRuntimeInfo, PiEnvironment } from '@shared/ipc/api-types'
import type { PiSettingsConfig } from '@shared/types/pi'
import { detectNodeRuntime } from './node-environment'

class PiEnvironmentService {
  async detect(override?: {
    cliPath?: string | null
    configDir?: string | null
  }): Promise<PiEnvironment> {
    const platform = process.platform
    const arch = process.arch
    const cliPath = await piProcess.resolveCliPath(override?.cliPath ?? undefined)
    const [version, nodeRuntime] = await Promise.all([
      cliPath ? piProcess.version() : null,
      detectNodeRuntime()
    ])

    const configDir = getPiConfigDir(override?.configDir)
    const settingsPath = path.join(configDir, PI_FILES.settings)
    const modelsConfigPath = path.join(configDir, PI_FILES.models)
    const modelsStorePath = path.join(configDir, PI_FILES.modelsStore)
    const authPath = path.join(configDir, PI_FILES.auth)

    const homeDir = homedir()
    const skillsDirs = await this.resolveSkillDirs(settingsPath)

    const { readable, writable, valid, error } = await this.checkConfig(configDir)
    const piStatus = !cliPath ? 'missing' : version ? 'ready' : 'failed'
    const state = !nodeRuntime.nodeInstalled
      ? 'node-required'
      : !nodeRuntime.nodeSupported
        ? 'node-outdated'
        : !nodeRuntime.npmInstalled
          ? 'npm-unavailable'
          : piStatus === 'ready'
            ? 'ready'
            : piStatus === 'failed'
              ? 'failed'
              : 'pi-required'

    log.pi.info('pi environment detected:', {
      installed: Boolean(cliPath),
      version,
      configDir,
      configValid: valid
    })

    return {
      installed: Boolean(cliPath),
      cliPath,
      version,
      homeDir,
      configDir,
      modelsConfigPath,
      settingsPath,
      modelsStorePath,
      authPath,
      skillsDirs,
      configReadable: readable,
      configWritable: writable,
      configValid: valid,
      configError: error,
      platform,
      arch,
      nodeRuntime,
      state,
      piStatus,
      checks: buildEnvironmentChecks({
        nodeRuntime,
        piInstalled: Boolean(cliPath),
        piVersion: version,
        piPath: cliPath,
        configDir,
        configReadable: readable,
        configWritable: writable,
        skillsDirs
      })
    }
  }

  private async resolveSkillDirs(settingsPath: string): Promise<string[]> {
    // The active Pi config directory is always the primary global skill root,
    // including when Settings points Pi-Harness at a non-default config dir.
    const dirs = new Set<string>([
      path.join(path.dirname(settingsPath), 'skills'),
      ...getDefaultSkillDirs()
    ])
    try {
      const text = await readTextFile(settingsPath)
      if (text) {
        const settings = JSON.parse(text) as PiSettingsConfig
        const skills = settings.skills ?? []
        for (const entry of skills) {
          const p = typeof entry === 'string' ? entry : entry?.source
          if (p) dirs.add(path.resolve(path.dirname(settingsPath), expandHome(p)))
        }
      }
    } catch (err) {
      log.pi.debug('could not read settings skills:', err)
    }
    return [...dirs]
  }

  private async checkConfig(configDir: string): Promise<{
    readable: boolean
    writable: boolean
    valid: boolean
    error: string | null
  }> {
    let readable = false
    let writable = false
    let valid = true
    let error: string | null = null

    try {
      await fs.access(configDir, fs.constants.R_OK)
      readable = true
    } catch {
      // config dir may not exist yet — that's fine, Pi isn't configured.
      return { readable: false, writable: false, valid: true, error: null }
    }

    try {
      await fs.access(configDir, fs.constants.W_OK)
      writable = true
    } catch {
      /* read-only config is still usable */
    }

    // Validate models.json + settings.json parse (round-trip aware, permissive).
    const modelsText = await readTextFile(path.join(configDir, PI_FILES.models))
    if (modelsText) {
      const parsed = this.tryJson(modelsText)
      if (parsed.ok) {
        const result = piModelsConfigSchema.safeParse(parsed.value)
        if (!result.success) {
          valid = false
          error = `models.json: ${this.formatZodError(result.error)}`
        }
      } else {
        valid = false
        error = `models.json parse error: ${parsed.error}`
      }
    }

    const settingsText = await readTextFile(path.join(configDir, PI_FILES.settings))
    if (settingsText) {
      const parsed = this.tryJson(settingsText)
      if (parsed.ok) {
        const result = piSettingsConfigSchema.safeParse(parsed.value)
        if (!result.success) {
          valid = false
          error =
            (error ? error + '; ' : '') + `settings.json: ${this.formatZodError(result.error)}`
        }
      } else {
        valid = false
        error = (error ? error + '; ' : '') + `settings.json parse error: ${parsed.error}`
      }
    }

    return { readable, writable, valid, error }
  }

  private tryJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
    try {
      return { ok: true, value: JSON.parse(text) }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  }

  private formatZodError(err: { issues: { path: PropertyKey[]; message: string }[] }): string {
    return err.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join(', ')
  }

  async getMtimes(configDir: string): Promise<{ models: number | null; settings: number | null }> {
    return {
      models: await fileMtime(path.join(configDir, PI_FILES.models)),
      settings: await fileMtime(path.join(configDir, PI_FILES.settings))
    }
  }
}

export const piEnvironment = new PiEnvironmentService()

export function buildEnvironmentChecks(input: {
  nodeRuntime: NodeRuntimeInfo
  piInstalled: boolean
  piVersion: string | null
  piPath: string | null
  configDir: string | null
  configReadable: boolean
  configWritable: boolean
  skillsDirs: string[]
}): EnvironmentCheckResult[] {
  const { nodeRuntime } = input
  const nodeStatus = !nodeRuntime.nodeInstalled
    ? ('error' as const)
    : nodeRuntime.nodeSupported
      ? ('healthy' as const)
      : ('warning' as const)
  const pathEntries = new Set(
    (nodeRuntime.resolvedPath || '').split(path.delimiter).filter(Boolean).map(pathIdentity)
  )
  const nodeDirectory = nodeRuntime.nodePath
    ? pathIdentity(path.dirname(nodeRuntime.nodePath))
    : null
  const nodeOnPath = Boolean(nodeDirectory && pathEntries.has(nodeDirectory))

  return [
    {
      id: 'node',
      status: nodeStatus,
      installed: nodeRuntime.nodeInstalled,
      version: nodeRuntime.nodeVersion,
      path: nodeRuntime.nodePath,
      message: !nodeRuntime.nodeInstalled
        ? 'Node.js was not found.'
        : nodeRuntime.nodeSupported
          ? `Node.js ${nodeRuntime.nodeVersion ?? ''} is supported.`
          : `Node.js ${nodeRuntime.nodeVersion ?? 'unknown'} is below ${nodeRuntime.minimumNodeVersion}.`,
      ...(nodeRuntime.nodeSupported
        ? {}
        : { remediation: 'Install or upgrade Node.js to version 22 or newer.' })
    },
    {
      id: 'npm',
      status: nodeRuntime.npmInstalled ? 'healthy' : 'error',
      installed: nodeRuntime.npmInstalled,
      version: nodeRuntime.npmVersion,
      path: nodeRuntime.npmPath,
      message: nodeRuntime.npmInstalled ? 'npm is available.' : 'npm was not found.',
      ...(nodeRuntime.npmInstalled ? {} : { remediation: 'Repair the Node.js/npm environment.' })
    },
    {
      id: 'pnpm',
      status: nodeRuntime.pnpmInstalled ? 'healthy' : 'warning',
      installed: nodeRuntime.pnpmInstalled,
      version: nodeRuntime.pnpmVersion,
      path: nodeRuntime.pnpmPath,
      message: nodeRuntime.pnpmInstalled ? 'pnpm is available.' : 'pnpm was not found.',
      ...(nodeRuntime.pnpmInstalled
        ? {}
        : { remediation: 'Install pnpm for development workflows.' })
    },
    {
      id: 'pi',
      status: !input.piInstalled ? 'warning' : input.piVersion ? 'healthy' : 'error',
      installed: input.piInstalled,
      version: input.piVersion,
      path: input.piPath,
      message: !input.piInstalled
        ? 'Pi Coding Agent is not installed.'
        : input.piVersion
          ? `Pi Coding Agent ${input.piVersion} is ready.`
          : 'Pi Coding Agent exists but its version could not be verified.',
      ...(!input.piInstalled ? { remediation: 'Install Pi Coding Agent from Overview.' } : {})
    },
    {
      id: 'path',
      status: nodeOnPath ? 'healthy' : 'warning',
      installed: nodeOnPath,
      version: null,
      path: nodeRuntime.resolvedPath || null,
      message: nodeOnPath
        ? 'The resolved PATH contains the active Node.js directory.'
        : 'The active Node.js executable is outside the resolved PATH.',
      ...(nodeOnPath ? {} : { remediation: 'Refresh or repair the desktop application PATH.' })
    },
    {
      id: 'config-directory',
      status: input.configReadable && input.configWritable ? 'healthy' : 'warning',
      installed: Boolean(input.configDir),
      version: null,
      path: input.configDir,
      message:
        input.configReadable && input.configWritable
          ? 'The Pi configuration directory is readable and writable.'
          : 'The Pi configuration directory is missing or not fully writable.',
      ...(input.configReadable && input.configWritable
        ? {}
        : { remediation: 'Check the configured directory and its permissions.' })
    },
    {
      id: 'skills-directory',
      status: input.skillsDirs.length ? 'healthy' : 'warning',
      installed: input.skillsDirs.length > 0,
      version: null,
      path: input.skillsDirs[0] ?? null,
      message: input.skillsDirs.length
        ? `${input.skillsDirs.length} Skills directory path(s) resolved.`
        : 'No Skills directory could be resolved.',
      ...(input.skillsDirs.length ? {} : { remediation: 'Check the Pi Skills configuration.' })
    }
  ]
}

function pathIdentity(value: string): string {
  const resolved = path.resolve(value)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

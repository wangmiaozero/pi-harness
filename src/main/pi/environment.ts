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
import type { PiEnvironment } from '@shared/ipc/api-types'
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
      nodeRuntime
    }
  }

  private async resolveSkillDirs(settingsPath: string): Promise<string[]> {
    const dirs = new Set<string>(getDefaultSkillDirs())
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

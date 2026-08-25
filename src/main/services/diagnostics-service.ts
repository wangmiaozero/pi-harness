/**
 * DiagnosticsService — aggregate environment report for the Diagnostics page.
 */

import { homedir } from 'node:os'
import fs from 'node:fs/promises'
import type { AppSettings, DiagnosticsReport } from '@shared/ipc/api-types'
import type { JsonStore } from './storage'
import { piEnvironment } from '../pi/environment'
import type { PiConfigService } from '../pi/config-service'
import { APP_VERSION } from '@shared/constants/index'
import { atomicWriteText } from './storage'
import path from 'node:path'
import { userData } from './app-paths'
import { secretStore } from '../security/secret-store'
import type { SessionService } from '../sessions/session-service'
import type { AgentRuntime } from '../agent/runtime'
import type { FileAccessService } from '../files/file-access-service'
import type { PiPackageManager } from '../packages/package-manager'
import type { CapabilityService } from '../capabilities/capability-service'
import type { SkillsService } from './skills-service'
import { resolveExecutable } from '../environment/command-resolver'
import { redactSecrets } from './logger'

export class DiagnosticsService {
  private workspace: {
    sessions: SessionService
    agent: AgentRuntime
    access: FileAccessService
  } | null = null

  constructor(
    private readonly settingsStore: JsonStore<AppSettings>,
    private readonly config: PiConfigService,
    private readonly packages?: PiPackageManager,
    private readonly capabilitiesService?: CapabilityService,
    private readonly skillsService?: SkillsService
  ) {}

  attachWorkspace(workspace: {
    sessions: SessionService
    agent: AgentRuntime
    access: FileAccessService
  }): void {
    this.workspace = workspace
  }

  async get(): Promise<DiagnosticsReport> {
    const settings = this.settingsStore.peek()
    const pi = await piEnvironment.detect({
      cliPath: settings.manualCliPath,
      configDir: settings.manualConfigDir
    })
    const config = await this.config.getStatus()
    const [packageList, packagePermissions, capabilityList, installedSkills, git] =
      await Promise.all([
        this.packages ? this.packages.list() : [],
        this.packages ? this.packages.permissions() : [],
        this.capabilitiesService ? this.capabilitiesService.list() : [],
        this.skillsService ? this.skillsService.list() : [],
        resolveExecutable('git')
      ])
    const secretBackend =
      process.platform === 'darwin'
        ? 'keychain'
        : secretStore.isAvailable()
          ? 'safeStorage'
          : 'unavailable'
    const sessionRoot = this.workspace?.sessions.sessionsRoot() ?? ''
    const allowedRoots = this.workspace ? [...(await this.workspace.access.getAllowedRoots())] : []
    const currentWorkspace = this.workspace?.access.getActiveRoot() ?? null
    const runtimeDiagnostics = this.workspace?.agent.diagnostics() ?? {
      implementation: 'pi' as const,
      sdkLoaded: false
    }
    const [sessionWritable, skillsWritable, workspaceWritable] = await Promise.all([
      isWritableDirectory(sessionRoot),
      someWritableDirectory(pi.skillsDirs),
      currentWorkspace ? isWritableDirectory(currentWorkspace) : null
    ])

    return {
      app: {
        version: APP_VERSION,
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node
      },
      environment: {
        state: pi.state,
        piStatus: pi.piStatus,
        nodeRuntime: pi.nodeRuntime,
        checks: pi.checks
      },
      pi: {
        installed: pi.installed,
        version: pi.version,
        cliPath: pi.cliPath,
        configDir: pi.configDir,
        configPath: pi.modelsConfigPath,
        skillsPath: pi.skillsDirs[0] ?? null,
        skillsDirs: pi.skillsDirs,
        configValid: pi.configValid,
        readPermission: pi.configReadable,
        writePermission: pi.configWritable
      },
      system: {
        platform: process.platform,
        arch: process.arch,
        shell: process.env.SHELL ?? null,
        homeDir: homedir(),
        pathSummary: (pi.nodeRuntime.resolvedPath || process.env.PATH || '')
          .split(path.delimiter)
          .slice(0, 8)
          .join(path.delimiter),
        secretBackend
      },
      storage: {
        config: { path: pi.configDir, writable: pi.configWritable },
        sessions: { path: sessionRoot, writable: sessionWritable },
        skills: { paths: pi.skillsDirs, writable: skillsWritable }
      },
      security: {
        secretStoreAvailable: secretBackend !== 'unavailable',
        backend: secretBackend,
        trustedIpcSenders: true,
        contextIsolation: true,
        nodeIntegration: false
      },
      git: {
        installed: git.found,
        version: git.version,
        path: git.path
      },
      capabilities: {
        registryCount: capabilityList.length,
        installedCount: capabilityList.filter((capability) => capability.installed).length,
        healthyCount: capabilityList.filter((capability) => capability.health === 'healthy').length,
        builtinSkillCount: installedSkills.filter((skill) => skill.origin === 'builtin').length
      },
      config,
      packages: {
        registryCount: packageList.filter((pkg) => pkg.registered).length,
        installedCount: packageList.filter((pkg) => pkg.installed).length,
        healthyCount: packageList.filter((pkg) => pkg.health === 'healthy').length,
        missingCount: packageList.filter((pkg) => pkg.health === 'missing').length,
        orphanedCount: packageList.filter((pkg) => pkg.health === 'orphaned').length,
        corruptedCount: packageList.filter((pkg) => pkg.health === 'corrupted').length,
        permissionErrorCount: packageList.filter((pkg) => pkg.health === 'permission-error').length,
        skillsCount: packageList.reduce((total, pkg) => total + pkg.resources.skills.length, 0),
        startupRisk: packageList.some(
          (pkg) => pkg.registered && !['healthy', 'unknown'].includes(pkg.health)
        ),
        registryPaths: [...new Set(packageList.map((pkg) => pkg.registryPath))],
        permissions: packagePermissions
      },
      workspace: {
        sessionRoot,
        sessionCount: this.workspace ? (await this.workspace.sessions.list()).length : 0,
        runningSessions: this.workspace?.agent.listRunning() ?? [],
        piSdkLoaded: runtimeDiagnostics.sdkLoaded,
        runtime: runtimeDiagnostics.implementation,
        currentWorkspace,
        writable: workspaceWritable,
        allowedRootCount: allowedRoots.length
      }
    }
  }

  async copyText(): Promise<string> {
    const report = await this.get()
    return formatDiagnosticsReport(report)
  }

  async export(): Promise<string> {
    const text = await this.copyText()
    const out = path.join(userData(), 'diagnostics', `diagnostics-${Date.now()}.json`)
    await atomicWriteText(out, text)
    return out
  }
}

export function formatDiagnosticsReport(
  report: DiagnosticsReport,
  homeDirectory = homedir()
): string {
  return JSON.stringify(maskHomePaths(redactSecrets(report), homeDirectory), null, 2)
}

function maskHomePaths(value: unknown, homeDirectory: string): unknown {
  if (typeof value === 'string') {
    return homeDirectory && value.includes(homeDirectory)
      ? value.split(homeDirectory).join('~')
      : value
  }
  if (Array.isArray(value)) return value.map((entry) => maskHomePaths(entry, homeDirectory))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      maskHomePaths(entry, homeDirectory)
    ])
  )
}

async function isWritableDirectory(directory: string): Promise<boolean> {
  if (!directory) return false
  try {
    await fs.access(directory, fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}

async function someWritableDirectory(directories: string[]): Promise<boolean> {
  const results = await Promise.all(directories.map(isWritableDirectory))
  return results.some(Boolean)
}

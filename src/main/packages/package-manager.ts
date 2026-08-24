import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type {
  AppSettings,
  PiPackageActionResult,
  PiPackageHealth,
  PiPackageInfo,
  PiPackagePermission,
  PiPackageProblem,
  PiPackageResource,
  PiPackageResources,
  PiPackageScope,
  PiPackageSourceType,
  PiPackageTarget
} from '@shared/ipc/api-types'
import type { JsonStore } from '../services/storage'
import { atomicWriteText, readTextFile } from '../services/storage'
import { piEnvironment } from '../pi/environment'
import { piProcess } from '../process/pi-process'
import type { PiConfigService } from '../pi/config-service'
import type { FileAccessService } from '../files/file-access-service'
import { capabilityBackupDir, getPiConfigDir } from '../services/app-paths'
import { ValidationError } from '../services/errors'
import { log } from '../services/logger'

const EMPTY_RESOURCES = (): PiPackageResources => ({
  skills: [],
  prompts: [],
  extensions: [],
  themes: [],
  tools: []
})

const execFileAsync = promisify(execFile)

const PACKAGE_SOURCE_PATTERN =
  /^(?:npm:[@a-zA-Z0-9._/-]+(?:@[a-zA-Z0-9._-]+)?|git:[^\s]+|(?:https?|ssh|git):\/\/[^\s]+|[a-zA-Z]:[\\/][^\0]+|\.?\.?[\\/][^\0]+|\/[^\0]+)$/

interface RegistryEntry {
  source: string
  raw: unknown
}

interface RegistryScope {
  scope: PiPackageScope
  projectRoot: string | null
  baseDir: string
  registryPath: string
  entries: RegistryEntry[]
}

interface RegistrySnapshot {
  path: string
  content: string | null
  scope: PiPackageScope
}

interface PackageManifest {
  name?: string
  version?: string
  description?: string
  dependencies?: Record<string, unknown>
  pi?: Partial<Record<'skills' | 'prompts' | 'extensions' | 'themes', unknown>>
}

type ResourceKind = 'skills' | 'prompts' | 'extensions' | 'themes'
type ResourceFilter = Partial<Record<ResourceKind, string[]>>

interface ResolvedSource {
  type: PiPackageSourceType
  name: string
  installPath: string | null
  managedRoot: string | null
}

interface PackageInspection {
  manifest: PackageManifest | null
  manifestState: 'valid' | 'missing' | 'invalid'
  resources: PiPackageResources
  resourceItems: PiPackageResource[]
  problems: PiPackageProblem[]
}

type PackageAction = PiPackageActionResult['action']

export class PiPackageManager {
  private readonly mutations = new Set<string>()

  constructor(
    private readonly settingsStore: JsonStore<AppSettings>,
    private readonly config?: PiConfigService,
    private readonly access?: FileAccessService
  ) {}

  async list(projectRoot?: string | null): Promise<PiPackageInfo[]> {
    const scopes = await this.registryScopes(projectRoot)
    const packages: PiPackageInfo[] = []
    for (const scope of scopes) {
      const grouped = new Map<string, RegistryEntry[]>()
      for (const entry of scope.entries) {
        const identity = packageIdentity(entry.source, scope.baseDir)
        grouped.set(identity, [...(grouped.get(identity) ?? []), entry])
      }
      for (const entries of grouped.values()) {
        const inspected = await this.inspectRegistered(scope, entries[0]!)
        if (entries.length > 1) {
          inspected.problems.push(
            problem(
              'REGISTRY_MISMATCH',
              `Package is registered ${entries.length} times`,
              scope.registryPath
            )
          )
          inspected.health = 'corrupted'
          inspected.healthy = false
        }
        packages.push(inspected)
      }
      packages.push(...(await this.scanOrphans(scope, packages)))
    }
    return packages.sort(
      (left, right) =>
        left.scope.localeCompare(right.scope) ||
        left.name.localeCompare(right.name) ||
        left.source.localeCompare(right.source)
    )
  }

  async install(
    target: PiPackageTarget,
    action: Extract<PackageAction, 'install' | 'repair' | 'register'> = 'install'
  ): Promise<PiPackageActionResult> {
    const normalized = await this.normalizeTarget(target)
    return this.withMutation(normalized, action, async () => {
      const logs: PiPackageActionResult['logs'] = [
        { phase: 'resolve', ok: true, message: `Resolved ${normalized.source}` }
      ]
      const snapshot = await this.backupRegistry(
        normalized,
        `${action} package ${normalized.source}`
      )
      logs.push({ phase: 'backup', ok: true, message: 'Registry backup created' })
      let process: Awaited<ReturnType<typeof piProcess.exec>>
      try {
        process = await this.executeCli('install', normalized)
      } catch (error) {
        await this.restoreRegistry(snapshot)
        const message = error instanceof Error ? error.message : String(error)
        logs.push({ phase: action, ok: false, message })
        logs.push({
          phase: 'rollback',
          ok: true,
          message: 'Registry restored from transaction snapshot'
        })
        return this.result(
          normalized,
          action,
          false,
          false,
          message,
          logs,
          undefined,
          classifyPackageError(message) ?? 'PROCESS_FAILED'
        )
      }
      logs.push({
        phase: action,
        ok: process.exitCode === 0,
        message:
          process.exitCode === 0 ? 'Pi package command completed' : 'Pi package command failed'
      })
      await this.reloadConfig()
      const after = await this.find(normalized)
      const verified = Boolean(after?.registered && after.installed && after.health === 'healthy')
      logs.push({
        phase: 'verify',
        ok: verified,
        message: verified ? 'Registry and files are healthy' : 'Package health verification failed'
      })
      if (process.exitCode !== 0 || !verified) {
        await this.restoreRegistry(snapshot)
        logs.push({
          phase: 'rollback',
          ok: true,
          message: 'Registry restored from transaction snapshot'
        })
        const errorCode = classifyPackageError(process.stderr || process.stdout)
        return this.result(
          normalized,
          action,
          false,
          false,
          errorCode === 'EACCES'
            ? 'Pi package directory permission denied'
            : process.exitCode !== 0
              ? `Package command failed (exit ${process.exitCode})`
              : 'Package verification failed',
          logs,
          process,
          errorCode ?? 'VERIFY_FAILED'
        )
      }
      return this.result(normalized, action, true, false, 'Package is healthy', logs, process)
    })
  }

  async uninstall(target: PiPackageTarget): Promise<PiPackageActionResult> {
    const normalized = await this.normalizeTarget(target)
    return this.withMutation(normalized, 'uninstall', async () => {
      const logs: PiPackageActionResult['logs'] = [
        { phase: 'resolve', ok: true, message: `Resolved ${normalized.source}` }
      ]
      const before = await this.find(normalized)
      if (!before?.registered) {
        return this.result(normalized, 'uninstall', true, true, 'Package is not registered', logs)
      }
      const snapshot = await this.backupRegistry(
        normalized,
        `uninstall package ${normalized.source}`
      )
      logs.push({ phase: 'backup', ok: true, message: 'Registry backup created' })
      if (before.health === 'missing') {
        try {
          await this.unregisterDirect(normalized)
        } catch (error) {
          await this.restoreRegistry(snapshot)
          const message = error instanceof Error ? error.message : String(error)
          logs.push({ phase: 'unregister-missing', ok: false, message })
          logs.push({
            phase: 'rollback',
            ok: true,
            message: 'Registry restored from transaction snapshot'
          })
          return this.result(
            normalized,
            'uninstall',
            false,
            false,
            message,
            logs,
            undefined,
            classifyPackageError(message) ?? 'PROCESS_FAILED'
          )
        }
        logs.push({
          phase: 'unregister-missing',
          ok: true,
          message: 'Removed stale registry entry; no package files exist'
        })
        await this.reloadConfig()
        const after = await this.find(normalized)
        const verified = !after?.registered && !after?.installed
        logs.push({
          phase: 'verify',
          ok: verified,
          message: verified ? 'Registry entry removed' : 'Registry entry remains'
        })
        if (!verified) {
          await this.restoreRegistry(snapshot)
          logs.push({
            phase: 'rollback',
            ok: true,
            message: 'Registry restored from transaction snapshot'
          })
        }
        return this.result(
          normalized,
          'uninstall',
          verified,
          false,
          verified ? 'Stale package registration removed' : 'Package registration remains',
          logs,
          undefined,
          verified ? null : 'VERIFY_FAILED'
        )
      }
      let process: Awaited<ReturnType<typeof piProcess.exec>>
      try {
        process = await this.executeCli('remove', normalized)
      } catch (error) {
        await this.restoreRegistry(snapshot)
        const message = error instanceof Error ? error.message : String(error)
        logs.push({ phase: 'unregister-and-remove', ok: false, message })
        logs.push({
          phase: 'rollback',
          ok: true,
          message: 'Registry restored from transaction snapshot'
        })
        return this.result(
          normalized,
          'uninstall',
          false,
          false,
          message,
          logs,
          undefined,
          classifyPackageError(message) ?? 'PROCESS_FAILED'
        )
      }
      logs.push({
        phase: 'unregister-and-remove',
        ok: process.exitCode === 0,
        message:
          process.exitCode === 0 ? 'Pi removed package and registry entry' : 'Pi remove failed'
      })

      await this.reloadConfig()
      const after = await this.find(normalized)
      const verified = !after?.registered && !after?.installed
      logs.push({
        phase: 'verify',
        ok: verified,
        message: verified ? 'Registry and managed files are removed' : 'Uninstall needs repair'
      })
      if (!verified) {
        await this.restoreRegistry(snapshot)
        logs.push({
          phase: 'rollback',
          ok: true,
          message: 'Registry restored from transaction snapshot'
        })
        const errorCode = classifyPackageError(process.stderr || process.stdout)
        return this.result(
          normalized,
          'uninstall',
          false,
          false,
          errorCode === 'EACCES'
            ? 'Permission denied while removing package files'
            : 'Package remains registered or installed',
          logs,
          process,
          errorCode ?? 'VERIFY_FAILED'
        )
      }
      return this.result(
        normalized,
        'uninstall',
        true,
        false,
        'Package fully uninstalled',
        logs,
        process
      )
    })
  }

  async deleteOrphan(target: PiPackageTarget): Promise<PiPackageActionResult> {
    const normalized = await this.normalizeTarget(target)
    return this.withMutation(normalized, 'delete-orphan', async () => {
      const logs: PiPackageActionResult['logs'] = [
        { phase: 'resolve', ok: true, message: `Resolved ${normalized.source}` }
      ]
      const current = await this.find(normalized)
      if (!current?.installed) {
        return this.result(
          normalized,
          'delete-orphan',
          true,
          true,
          'Files are already absent',
          logs
        )
      }
      if (current.registered || !current.managed || !current.path) {
        throw new ValidationError('Only unregistered managed package files can be deleted')
      }
      await this.assertManagedDeleteTarget(current)
      await fs.rm(current.path, { recursive: true, force: true })
      logs.push({
        phase: 'delete',
        ok: true,
        message: 'Deleted orphan package files',
        path: current.path
      })
      const after = await this.find(normalized)
      const verified = !after?.installed
      logs.push({
        phase: 'verify',
        ok: verified,
        message: verified ? 'Orphan removed' : 'Files remain'
      })
      return this.result(
        normalized,
        'delete-orphan',
        verified,
        false,
        verified ? 'Orphan package removed' : 'Orphan package removal failed',
        logs,
        undefined,
        verified ? null : 'VERIFY_FAILED'
      )
    })
  }

  async permissions(projectRoot?: string | null): Promise<PiPackagePermission[]> {
    const scopes = await this.registryScopes(projectRoot)
    const reports: PiPackagePermission[] = []
    for (const scope of scopes) {
      const candidates = [
        scope.baseDir,
        path.join(scope.baseDir, 'npm'),
        path.join(scope.baseDir, 'npm', 'node_modules'),
        path.join(scope.baseDir, 'git')
      ]
      for (const candidate of candidates) reports.push(await inspectPermission(candidate))
      for (const managedRoot of [
        path.join(scope.baseDir, 'npm', 'node_modules'),
        path.join(scope.baseDir, 'git')
      ]) {
        const deepProblem = await findNestedPermissionProblem(managedRoot)
        if (deepProblem && !reports.some((entry) => entry.path === deepProblem.path)) {
          reports.push(deepProblem)
        }
      }
    }
    return reports
  }

  async repairPermissions(projectRoot?: string | null): Promise<PiPackagePermission[]> {
    const scopes = await this.registryScopes(projectRoot)
    for (const scope of scopes) {
      await repairSingleOwnedPermission(scope.baseDir)
      for (const root of [path.join(scope.baseDir, 'npm'), path.join(scope.baseDir, 'git')]) {
        await repairOwnedPermissions(root)
      }
    }
    const remaining = await this.permissions(projectRoot)
    if (process.platform === 'darwin' && remaining.some((entry) => entry.ownerMatches === false)) {
      await repairForeignOwnershipWithMacAuthorization(scopes, remaining).catch((error) =>
        log.skills.warn('package permission authorization was not completed', error)
      )
    }
    return this.permissions(projectRoot)
  }

  private async inspectRegistered(
    scope: RegistryScope,
    entry: RegistryEntry
  ): Promise<PiPackageInfo> {
    const resolved = resolvePackageSource(scope.baseDir, entry.source)
    return this.inspectPackage(
      scope,
      entry.source,
      resolved,
      true,
      resourceFilterFromRegistry(entry.raw)
    )
  }

  private async inspectPackage(
    scope: RegistryScope,
    source: string,
    resolved: ResolvedSource,
    registered: boolean,
    resourceFilter?: ResourceFilter
  ): Promise<PiPackageInfo> {
    const id = packageId(scope.scope, source, scope.baseDir)
    const installPath = resolved.installPath
    const rootPermission = installPath ? await inspectPermission(installPath) : null
    const exists = rootPermission?.exists ?? false
    const inspection =
      exists &&
      installPath &&
      rootPermission?.readable &&
      (rootPermission.executable || resolved.type === 'local')
        ? await inspectPackageContents(
            id,
            installPath,
            resolved.type,
            scope.baseDir,
            resourceFilter
          )
        : {
            manifest: null,
            manifestState: 'missing' as const,
            resources: EMPTY_RESOURCES(),
            resourceItems: [],
            problems: []
          }
    const permissions = rootPermission ? [rootPermission] : []
    const problems = [...inspection.problems]
    if (registered && !exists) {
      problems.push(
        problem('FILES_MISSING', 'Package is registered but files are missing', installPath)
      )
    }
    if (!registered && exists) {
      problems.push(
        problem('ORPHANED_FILES', 'Package files exist without a registry entry', installPath)
      )
    }
    if (resolved.type === 'unknown' || !installPath) {
      problems.push(problem('UNKNOWN_SOURCE', 'Package source could not be resolved', null, false))
    }
    for (const permission of permissions) {
      if (
        permission.exists &&
        (!permission.readable || !permission.writable || permission.ownerMatches === false)
      ) {
        problems.push(
          problem(
            'PERMISSION_ERROR',
            permission.problem || 'Package permission error',
            permission.path
          )
        )
      }
    }
    const health = resolveHealth(registered, exists, problems)
    const manifest = inspection.manifest
    return {
      id,
      source,
      name: manifest?.name || resolved.name,
      sourceType: resolved.type,
      scope: scope.scope,
      projectRoot: scope.projectRoot,
      registered,
      registryPath: scope.registryPath,
      version: manifest?.version ?? null,
      description: manifest?.description ?? '',
      path: installPath,
      installed: exists,
      available: exists && inspection.manifestState !== 'invalid',
      healthy: health === 'healthy',
      health,
      managed: Boolean(resolved.managedRoot),
      resources: inspection.resources,
      resourceItems: inspection.resourceItems,
      problems: dedupeProblems(problems),
      permissions
    }
  }

  private async scanOrphans(
    scope: RegistryScope,
    knownPackages: PiPackageInfo[]
  ): Promise<PiPackageInfo[]> {
    const knownPaths = new Set(
      knownPackages
        .filter((pkg) => pkg.scope === scope.scope && pkg.path)
        .map((pkg) => path.resolve(pkg.path!))
    )
    const orphans: PiPackageInfo[] = []
    const npmRoot = path.join(scope.baseDir, 'npm', 'node_modules')
    for (const packagePath of await topLevelNpmPackages(npmRoot)) {
      if (knownPaths.has(path.resolve(packagePath))) continue
      const manifest = await readManifest(path.join(packagePath, 'package.json'))
      if (manifest.state !== 'valid' || !manifest.value?.name) continue
      if (!(await looksLikePiPackage(packagePath, manifest.value))) continue
      const source = `npm:${manifest.value.name}`
      orphans.push(
        await this.inspectPackage(
          scope,
          source,
          {
            type: 'npm',
            name: manifest.value.name,
            installPath: packagePath,
            managedRoot: npmRoot
          },
          false
        )
      )
    }

    const gitRoot = path.join(scope.baseDir, 'git')
    for (const packagePath of await discoverGitPackages(gitRoot)) {
      if (knownPaths.has(path.resolve(packagePath))) continue
      const manifest = await readManifest(path.join(packagePath, 'package.json'))
      if (!(await looksLikePiPackage(packagePath, manifest.value))) continue
      const source =
        (await readGitOrigin(packagePath)) || `git:${path.relative(gitRoot, packagePath)}`
      orphans.push(
        await this.inspectPackage(
          scope,
          source,
          {
            type: 'git',
            name: manifest.value?.name || path.basename(packagePath),
            installPath: packagePath,
            managedRoot: gitRoot
          },
          false
        )
      )
    }
    return orphans
  }

  private async registryScopes(projectRoot?: string | null): Promise<RegistryScope[]> {
    const settings = this.settingsStore.peek()
    const environment = await piEnvironment.detect({
      cliPath: settings.manualCliPath,
      configDir: settings.manualConfigDir
    })
    if (!environment.configDir) return []
    const scopes: RegistryScope[] = [await readRegistryScope('global', null, environment.configDir)]
    if (projectRoot) {
      const allowed = this.access
        ? await this.access.assertAllowed(projectRoot, { mustExist: true })
        : path.resolve(projectRoot)
      scopes.push(await readRegistryScope('project', allowed, path.join(allowed, '.pi')))
    }
    return scopes
  }

  private async normalizeTarget(target: PiPackageTarget): Promise<PiPackageTarget> {
    const source = target.source?.trim()
    if (!source || !PACKAGE_SOURCE_PATTERN.test(source) || /[$<>\0]/.test(source)) {
      throw new ValidationError(`Invalid package source: ${source || '<empty>'}`)
    }
    if (!['global', 'project'].includes(target.scope)) {
      throw new ValidationError('Invalid package scope')
    }
    if (target.scope === 'project') {
      if (!target.projectRoot)
        throw new ValidationError('Project package target requires projectRoot')
      const projectRoot = this.access
        ? await this.access.assertAllowed(target.projectRoot, { mustExist: true })
        : path.resolve(target.projectRoot)
      return { source, scope: 'project', projectRoot }
    }
    return { source, scope: 'global', projectRoot: null }
  }

  private async executeCli(command: 'install' | 'remove', target: PiPackageTarget) {
    const project = target.scope === 'project'
    const settings = this.settingsStore.peek()
    return piProcess.exec({
      args: [command, target.source, ...(project ? ['--local', '--approve'] : ['--no-approve'])],
      timeoutMs: 5 * 60_000,
      cliPath: settings.manualCliPath,
      env: { PI_CODING_AGENT_DIR: getPiConfigDir(settings.manualConfigDir) },
      ...(project && target.projectRoot ? { cwd: target.projectRoot } : {})
    })
  }

  private async backupRegistry(target: PiPackageTarget, reason: string): Promise<RegistrySnapshot> {
    const scopes = await this.registryScopes(target.projectRoot)
    const scope = scopes.find((entry) => entry.scope === target.scope)
    if (!scope) throw new ValidationError('Package registry could not be resolved')
    const text = await readTextFile(scope.registryPath)
    if (target.scope === 'global' && this.config) {
      await this.config.backupSettings(reason)
      return { path: scope.registryPath, content: text, scope: target.scope }
    }
    if (text === null) return { path: scope.registryPath, content: null, scope: target.scope }
    const dir = path.join(capabilityBackupDir(), 'package-settings')
    await fs.mkdir(dir, { recursive: true })
    const safeName = `${target.scope}-${Date.now()}-${path.basename(scope.registryPath)}.json`
    await atomicWriteText(path.join(dir, safeName), text)
    await pruneFiles(dir, 10)
    return { path: scope.registryPath, content: text, scope: target.scope }
  }

  private async restoreRegistry(snapshot: RegistrySnapshot): Promise<void> {
    if (snapshot.scope === 'global' && this.config) {
      await this.config.writeSettingsRaw(snapshot.content ?? '{}\n', {
        overwrite: true,
        skipBackup: true,
        reason: 'package transaction rollback'
      })
      return
    }
    await fs.mkdir(path.dirname(snapshot.path), { recursive: true })
    await atomicWriteText(snapshot.path, snapshot.content ?? '{}\n')
  }

  private async unregisterDirect(target: PiPackageTarget): Promise<void> {
    if (target.scope === 'global' && this.config) {
      await this.config.patchSettings(
        (settings) => ({
          ...settings,
          packages: removeRegistryPackage(
            settings.packages,
            target.source,
            getPiConfigDir(this.settingsStore.peek().manualConfigDir)
          )
        }),
        { overwrite: true, reason: `remove missing package ${target.source}` }
      )
      return
    }
    const scopes = await this.registryScopes(target.projectRoot)
    const scope = scopes.find((entry) => entry.scope === target.scope)
    if (!scope) return
    const text = await readTextFile(scope.registryPath)
    const settings = text ? (JSON.parse(text) as Record<string, unknown>) : {}
    settings.packages = removeRegistryPackage(settings.packages, target.source, scope.baseDir)
    await fs.mkdir(path.dirname(scope.registryPath), { recursive: true })
    await atomicWriteText(scope.registryPath, JSON.stringify(settings, null, 2) + '\n')
  }

  private async reloadConfig(): Promise<void> {
    await this.config
      ?.read()
      .catch((error) => log.config.warn('package config reload failed', error))
  }

  private async find(target: PiPackageTarget): Promise<PiPackageInfo | null> {
    const packages = await this.list(target.projectRoot)
    const scopes = await this.registryScopes(target.projectRoot)
    const baseDir = scopes.find((scope) => scope.scope === target.scope)?.baseDir
    const id = packageId(target.scope, target.source, baseDir)
    return (
      packages.find((pkg) => pkg.id === id) ??
      packages.find(
        (pkg) =>
          pkg.scope === target.scope &&
          packageIdentity(pkg.source, baseDir) === packageIdentity(target.source, baseDir)
      ) ??
      null
    )
  }

  private async assertManagedDeleteTarget(pkg: PiPackageInfo): Promise<void> {
    const scopes = await this.registryScopes(pkg.projectRoot)
    const scope = scopes.find((entry) => entry.scope === pkg.scope)
    if (!scope || !pkg.path) throw new ValidationError('Package scope could not be resolved')
    const roots = [path.join(scope.baseDir, 'npm', 'node_modules'), path.join(scope.baseDir, 'git')]
    const target = path.resolve(pkg.path)
    const root = roots.find((candidate) => target.startsWith(path.resolve(candidate) + path.sep))
    if (!root) throw new ValidationError('Refusing to delete package outside managed roots')
    const realRoot = await fs.realpath(root)
    const realTarget = await fs.realpath(target)
    if (!realTarget.startsWith(realRoot + path.sep)) {
      throw new ValidationError('Refusing to delete package symlink outside managed roots')
    }
  }

  private async withMutation<T>(
    target: PiPackageTarget,
    action: PackageAction,
    operation: () => Promise<T>
  ): Promise<T> {
    const baseDir =
      target.scope === 'project' && target.projectRoot
        ? path.join(target.projectRoot, '.pi')
        : getPiConfigDir(this.settingsStore.peek().manualConfigDir)
    const key = `${target.scope}:${packageIdentity(target.source, baseDir)}`
    if (this.mutations.has(key)) throw new ValidationError('Package operation already running')
    this.mutations.add(key)
    try {
      return await operation()
    } finally {
      this.mutations.delete(key)
      log.skills.info('package mutation finished', {
        action,
        source: target.source,
        scope: target.scope
      })
    }
  }

  private result(
    target: PiPackageTarget,
    action: PackageAction,
    ok: boolean,
    skipped: boolean,
    message: string,
    logs: PiPackageActionResult['logs'],
    process?: { stdout: string; stderr: string },
    errorCode: PiPackageActionResult['errorCode'] = null
  ): PiPackageActionResult {
    return {
      source: target.source,
      scope: target.scope,
      action,
      ok,
      skipped,
      message,
      stdout: process?.stdout ?? '',
      stderr: process?.stderr ?? '',
      errorCode,
      logs
    }
  }
}

async function readRegistryScope(
  scope: PiPackageScope,
  projectRoot: string | null,
  baseDir: string
): Promise<RegistryScope> {
  const registryPath = path.join(baseDir, 'settings.json')
  const text = await readTextFile(registryPath)
  let rawPackages: unknown[] = []
  if (text) {
    try {
      const parsed = JSON.parse(text) as { packages?: unknown }
      rawPackages = Array.isArray(parsed.packages) ? parsed.packages : []
    } catch (error) {
      log.skills.warn('could not parse package registry', { registryPath, error })
    }
  }
  const entries = rawPackages
    .map((raw): RegistryEntry | null => {
      if (typeof raw === 'string') return { source: raw, raw }
      if (
        raw &&
        typeof raw === 'object' &&
        typeof (raw as { source?: unknown }).source === 'string'
      ) {
        return { source: (raw as { source: string }).source, raw }
      }
      return null
    })
    .filter((entry): entry is RegistryEntry => Boolean(entry))
  return { scope, projectRoot, baseDir, registryPath, entries }
}

function resolvePackageSource(baseDir: string, source: string): ResolvedSource {
  if (source.startsWith('npm:')) {
    const name = packageNameFromSource(source)
    const managedRoot = path.join(baseDir, 'npm', 'node_modules')
    return { type: 'npm', name, installPath: path.join(managedRoot, name), managedRoot }
  }
  const git = parseGitSource(source)
  if (git) {
    const managedRoot = path.join(baseDir, 'git')
    return {
      type: 'git',
      name: path.basename(git.packagePath),
      installPath: path.join(managedRoot, git.host, git.packagePath),
      managedRoot
    }
  }
  if (path.isAbsolute(source) || source.startsWith('./') || source.startsWith('../')) {
    const installPath = path.isAbsolute(source)
      ? path.resolve(source)
      : path.resolve(baseDir, source)
    return { type: 'local', name: path.basename(installPath), installPath, managedRoot: null }
  }
  return { type: 'unknown', name: source, installPath: null, managedRoot: null }
}

function parseGitSource(source: string): { host: string; packagePath: string } | null {
  const value = source.startsWith('git:') ? source.slice(4) : source
  if (!source.startsWith('git:') && !/^(?:https?|ssh|git):\/\//i.test(value)) return null
  const scp = value.match(/^git@([^:]+):(.+)$/)
  let host = ''
  let packagePath = ''
  if (scp) {
    host = scp[1] ?? ''
    packagePath = scp[2] ?? ''
  } else if (value.includes('://')) {
    try {
      const url = new URL(value)
      host = url.hostname
      packagePath = url.pathname.replace(/^\/+/, '')
    } catch {
      return null
    }
  } else {
    const slash = value.indexOf('/')
    if (slash < 1) return null
    host = value.slice(0, slash)
    packagePath = value.slice(slash + 1)
  }
  const refAt = packagePath.indexOf('@')
  if (refAt > 0) packagePath = packagePath.slice(0, refAt)
  packagePath = packagePath.replace(/\.git$/i, '').replace(/^\/+/, '')
  if (!host || !packagePath || packagePath.split('/').includes('..')) return null
  return { host, packagePath }
}

async function inspectPackageContents(
  packageIdValue: string,
  packagePath: string,
  sourceType: PiPackageSourceType,
  baseDir: string,
  resourceFilter?: ResourceFilter
): Promise<PackageInspection> {
  const packageStat = await lstatOrNull(packagePath)
  if (packageStat?.isFile()) {
    const extension = path.extname(packagePath).toLowerCase()
    const isExtension = ['.ts', '.js', '.mjs', '.cjs'].includes(extension)
    const extensionItems: PiPackageResource[] = isExtension
      ? [
          {
            type: 'extension',
            name: path.basename(packagePath, extension),
            path: packagePath,
            packageId: packageIdValue
          }
        ]
      : []
    const toolItems = await discoverDeclaredTools(packageIdValue, extensionItems)
    return {
      manifest: null,
      manifestState: 'missing',
      resources: {
        ...EMPTY_RESOURCES(),
        extensions: isExtension ? [path.basename(packagePath, extension)] : [],
        tools: toolItems.map((item) => item.name)
      },
      resourceItems: [...extensionItems, ...toolItems],
      problems: isExtension
        ? []
        : [problem('MANIFEST_MISSING', 'Local package file is not a Pi extension', packagePath)]
    }
  }
  const manifestResult = await readManifest(path.join(packagePath, 'package.json'))
  const manifest = manifestResult.value
  const resources = EMPTY_RESOURCES()
  const resourceItems: PiPackageResource[] = []
  const problems: PiPackageProblem[] = []
  if (sourceType === 'npm' && manifestResult.state === 'missing') {
    problems.push(problem('MANIFEST_MISSING', 'npm package.json is missing', packagePath))
  } else if (manifestResult.state === 'invalid') {
    problems.push(problem('MANIFEST_INVALID', 'package.json is invalid', packagePath))
  }

  const kinds = ['skills', 'prompts', 'extensions', 'themes'] as const
  for (const kind of kinds) {
    const hasPiManifest = Boolean(manifest?.pi && typeof manifest.pi === 'object')
    const declaredValue = manifest?.pi?.[kind]
    const entries = hasPiManifest
      ? Array.isArray(declaredValue)
        ? stringArray(declaredValue)
        : []
      : [kind]
    let discovered = await discoverResources(packagePath, kind, entries)
    const filter = resourceFilter?.[kind]
    if (filter !== undefined) discovered = applyResourceFilter(packagePath, discovered, filter)
    resources[kind] = discovered.map((entry) => entry.name)
    for (const entry of discovered) {
      resourceItems.push({
        type:
          kind === 'skills'
            ? 'skill'
            : kind === 'prompts'
              ? 'prompt'
              : (kind.slice(0, -1) as 'extension' | 'theme'),
        name: entry.name,
        path: entry.path,
        packageId: packageIdValue
      })
    }
  }

  const toolItems = await discoverDeclaredTools(
    packageIdValue,
    resourceItems.filter((item) => item.type === 'extension')
  )
  resourceItems.push(...toolItems)
  resources.tools = toolItems.map((item) => item.name)

  if (manifest?.dependencies) {
    for (const dependency of Object.keys(manifest.dependencies)) {
      const local = path.join(packagePath, 'node_modules', dependency)
      const hoisted = path.join(baseDir, 'npm', 'node_modules', dependency)
      if (!(await lstatOrNull(local)) && !(await lstatOrNull(hoisted))) {
        problems.push(
          problem('DEPENDENCY_MISSING', `Runtime dependency is missing: ${dependency}`, local)
        )
        break
      }
    }
  }
  return {
    manifest,
    manifestState: manifestResult.state,
    resources,
    resourceItems,
    problems
  }
}

async function discoverDeclaredTools(
  packageIdValue: string,
  extensions: PiPackageResource[]
): Promise<PiPackageResource[]> {
  const tools = new Map<string, PiPackageResource>()
  for (const extension of extensions) {
    const stat = await lstatOrNull(extension.path)
    if (!stat?.isFile() || stat.size > 1024 * 1024) continue
    let source = ''
    try {
      source = (await fs.readFile(extension.path, 'utf8')) || ''
    } catch {
      continue
    }
    const patterns = [
      /registerTool\s*\(\s*\{[\s\S]{0,1200}?\bname\s*:\s*['"]([^'"]+)['"]/g,
      /defineTool\s*\(\s*\{[\s\S]{0,1200}?\bname\s*:\s*['"]([^'"]+)['"]/g
    ]
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) {
        const name = match[1]?.trim()
        if (!name || tools.has(name)) continue
        tools.set(name, {
          type: 'tool',
          name,
          path: extension.path,
          packageId: packageIdValue
        })
      }
    }
  }
  return [...tools.values()].sort((left, right) => left.name.localeCompare(right.name))
}

async function discoverResources(
  packageRoot: string,
  kind: 'skills' | 'prompts' | 'extensions' | 'themes',
  entries: string[]
): Promise<{ name: string; path: string }[]> {
  const found = new Map<string, string>()
  for (const rawEntry of entries) {
    if (!rawEntry || rawEntry.startsWith('!') || rawEntry.startsWith('-')) continue
    const entry = rawEntry.startsWith('+') ? rawEntry.slice(1) : rawEntry
    const prefix = entry.split(/[?*\[]/, 1)[0] || kind
    const target = safeResourcePath(packageRoot, prefix.replace(/[\\/]$/, ''))
    if (!target) continue
    await walk(target, 0, async (itemPath, isDirectory) => {
      if (kind === 'skills') {
        if (!isDirectory && path.basename(itemPath).toLowerCase() === 'skill.md') {
          found.set(path.dirname(itemPath), path.basename(path.dirname(itemPath)))
        }
        return
      }
      if (isDirectory) return
      const extensions = {
        prompts: new Set(['.md']),
        extensions: new Set(['.ts', '.js', '.mjs', '.cjs']),
        themes: new Set(['.json'])
      }[kind]
      const extension = path.extname(itemPath).toLowerCase()
      if (extensions.has(extension)) found.set(itemPath, path.basename(itemPath, extension))
    })
  }
  const discovered = [...found.entries()]
    .map(([itemPath, name]) => ({ name, path: itemPath }))
    .sort((left, right) => left.name.localeCompare(right.name))
  return applyResourceFilter(packageRoot, discovered, entries)
}

function resourceFilterFromRegistry(raw: unknown): ResourceFilter | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const filter: ResourceFilter = {}
  let found = false
  for (const kind of ['skills', 'prompts', 'extensions', 'themes'] as const) {
    if (!(kind in raw)) continue
    const value = (raw as Record<string, unknown>)[kind]
    filter[kind] = stringArray(value)
    found = true
  }
  return found ? filter : undefined
}

function applyResourceFilter<T extends { path: string }>(
  packageRoot: string,
  resources: T[],
  patterns: string[]
): T[] {
  if (patterns.length === 0) return []
  const normalized = patterns.map((pattern) => pattern.trim()).filter(Boolean)
  const includes = normalized.filter(
    (pattern) => !pattern.startsWith('!') && !pattern.startsWith('-')
  )
  const excludes = normalized
    .filter((pattern) => pattern.startsWith('!') || pattern.startsWith('-'))
    .map((pattern) => pattern.slice(1))
  return resources.filter((resource) => {
    const relative = path.relative(packageRoot, resource.path).split(path.sep).join('/')
    const included =
      includes.length === 0 || includes.some((pattern) => resourcePatternMatches(relative, pattern))
    return included && !excludes.some((pattern) => resourcePatternMatches(relative, pattern))
  })
}

function resourcePatternMatches(relativePath: string, rawPattern: string): boolean {
  const pattern = rawPattern.replace(/^\+/, '').replace(/^\.\//, '').replace(/\/$/, '')
  if (!pattern) return false
  const candidates = [relativePath, `${relativePath}/SKILL.md`]
  if (!/[?*]/.test(pattern)) {
    return candidates.some(
      (candidate) => candidate === pattern || candidate.startsWith(`${pattern}/`)
    )
  }
  let expression = '^'
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index]!
    if (character === '*' && pattern[index + 1] === '*') {
      expression += '.*'
      index++
    } else if (character === '*') {
      expression += '[^/]*'
    } else if (character === '?') {
      expression += '[^/]'
    } else {
      expression += character.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
    }
  }
  const regexp = new RegExp(`${expression}(?:/.*)?$`)
  return candidates.some((candidate) => regexp.test(candidate))
}

async function readManifest(
  manifestPath: string
): Promise<{ state: 'valid' | 'missing' | 'invalid'; value: PackageManifest | null }> {
  const text = await readTextFile(manifestPath)
  if (text === null) return { state: 'missing', value: null }
  try {
    return { state: 'valid', value: JSON.parse(text) as PackageManifest }
  } catch {
    return { state: 'invalid', value: null }
  }
}

async function looksLikePiPackage(
  packagePath: string,
  manifest: PackageManifest | null
): Promise<boolean> {
  if (manifest?.pi && typeof manifest.pi === 'object') return true
  for (const kind of ['skills', 'prompts', 'extensions', 'themes'] as const) {
    if ((await discoverResources(packagePath, kind, [kind])).length > 0) return true
  }
  return false
}

async function topLevelNpmPackages(root: string): Promise<string[]> {
  const entries = await readdirSafe(root)
  const packages: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const target = path.join(root, entry.name)
    if (!entry.name.startsWith('@')) {
      packages.push(target)
      continue
    }
    for (const scoped of await readdirSafe(target)) {
      if (scoped.isDirectory() && !scoped.name.startsWith('.'))
        packages.push(path.join(target, scoped.name))
    }
  }
  return packages
}

async function discoverGitPackages(root: string): Promise<string[]> {
  const found: string[] = []
  async function scan(current: string, depth: number): Promise<void> {
    if (depth > 4) return
    if (await lstatOrNull(path.join(current, '.git'))) {
      found.push(current)
      return
    }
    for (const entry of await readdirSafe(current)) {
      if (entry.isDirectory() && !entry.name.startsWith('.'))
        await scan(path.join(current, entry.name), depth + 1)
    }
  }
  await scan(root, 0)
  return found
}

async function readGitOrigin(packagePath: string): Promise<string | null> {
  const config = await readTextFile(path.join(packagePath, '.git', 'config'))
  if (!config) return null
  const remote = config.match(/\[remote "origin"\][\s\S]*?\n\s*url\s*=\s*([^\r\n]+)/)?.[1]?.trim()
  if (!remote) return null
  return remote.includes('://') ? remote : `git:${remote}`
}

async function inspectPermission(target: string): Promise<PiPackagePermission> {
  const currentUid = typeof process.getuid === 'function' ? process.getuid() : null
  let stat: Awaited<ReturnType<typeof fs.lstat>> | null = null
  let statError: NodeJS.ErrnoException | null = null
  try {
    stat = await fs.lstat(target)
  } catch (error) {
    statError = error as NodeJS.ErrnoException
  }
  if (!stat) {
    const inaccessible = statError?.code !== 'ENOENT' && statError !== null
    return {
      path: target,
      exists: inaccessible,
      readable: false,
      writable: false,
      executable: false,
      ownerUid: null,
      currentUid,
      ownerMatches: null,
      problem: inaccessible
        ? `${statError?.code ?? 'FILE_SYSTEM_ERROR'}: ${statError?.message ?? 'Cannot inspect path'}`
        : null
    }
  }
  const [readable, writable, executable] = await Promise.all([
    hasAccess(target, fs.constants.R_OK),
    hasAccess(target, fs.constants.W_OK),
    hasAccess(target, fs.constants.X_OK)
  ])
  const ownerUid = typeof stat.uid === 'number' ? stat.uid : null
  const ownerMatches = ownerUid === null || currentUid === null ? null : ownerUid === currentUid
  const problem =
    ownerMatches === false
      ? `Owner uid ${ownerUid} differs from current uid ${currentUid}`
      : !readable || !writable || (stat.isDirectory() && !executable)
        ? 'Current user lacks read/write/execute permission'
        : null
  return {
    path: target,
    exists: true,
    readable,
    writable,
    executable,
    ownerUid,
    currentUid,
    ownerMatches,
    problem
  }
}

async function findNestedPermissionProblem(root: string): Promise<PiPackagePermission | null> {
  let visited = 0
  const maxEntries = 4000
  async function scan(current: string, depth: number): Promise<PiPackagePermission | null> {
    if (depth > 6 || visited++ > maxEntries) return null
    const permission = await inspectPermission(current)
    if (permission.exists && permission.problem) return permission
    const stat = await lstatOrNull(current)
    if (!stat?.isDirectory() || stat.isSymbolicLink()) return null
    for (const entry of await readdirSafe(current)) {
      const found = await scan(path.join(current, entry.name), depth + 1)
      if (found) return found
    }
    return null
  }
  return scan(root, 0)
}

async function repairOwnedPermissions(root: string): Promise<void> {
  const currentUid = typeof process.getuid === 'function' ? process.getuid() : null
  if (currentUid === null) return
  async function repair(current: string, depth: number): Promise<void> {
    if (depth > 8) return
    const stat = await lstatOrNull(current)
    if (!stat || stat.isSymbolicLink()) return
    if (stat.uid === currentUid) {
      const ownerReadWrite = 0o600
      const ownerExecute = stat.isDirectory() || (stat.mode & 0o100) !== 0 ? 0o100 : 0
      await fs.chmod(current, stat.mode | ownerReadWrite | ownerExecute).catch(() => undefined)
    }
    if (!stat.isDirectory()) return
    for (const entry of await readdirSafe(current))
      await repair(path.join(current, entry.name), depth + 1)
  }
  await repair(root, 0)
}

async function repairSingleOwnedPermission(target: string): Promise<void> {
  const currentUid = typeof process.getuid === 'function' ? process.getuid() : null
  if (currentUid === null) return
  const stat = await lstatOrNull(target)
  if (!stat || stat.isSymbolicLink() || stat.uid !== currentUid) return
  const ownerExecute = stat.isDirectory() || (stat.mode & 0o100) !== 0 ? 0o100 : 0
  await fs.chmod(target, stat.mode | 0o600 | ownerExecute).catch(() => undefined)
}

async function repairForeignOwnershipWithMacAuthorization(
  scopes: RegistryScope[],
  permissions: PiPackagePermission[]
): Promise<void> {
  const uid = typeof process.getuid === 'function' ? process.getuid() : null
  const gid = typeof process.getgid === 'function' ? process.getgid() : null
  if (uid === null || gid === null) return
  const commands: string[] = []
  for (const scope of scopes) {
    if (
      permissions.some(
        (permission) =>
          permission.path === scope.baseDir &&
          permission.exists &&
          permission.ownerMatches === false
      )
    ) {
      commands.push(
        `/usr/sbin/chown ${uid}:${gid} ${shellQuote(scope.baseDir)}`,
        `/bin/chmod u+rwx ${shellQuote(scope.baseDir)}`
      )
    }
    for (const root of [path.join(scope.baseDir, 'npm'), path.join(scope.baseDir, 'git')]) {
      const rootStat = await lstatOrNull(root)
      if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) continue
      const hasForeignOwner = permissions.some(
        (permission) =>
          permission.exists &&
          permission.ownerMatches === false &&
          (permission.path === root || permission.path.startsWith(root + path.sep))
      )
      if (!hasForeignOwner) continue
      commands.push(
        `/usr/sbin/chown -R ${uid}:${gid} ${shellQuote(root)}`,
        `/bin/chmod -R u+rwX ${shellQuote(root)}`
      )
    }
  }
  if (!commands.length) return
  const command = commands.join(' && ')
  const appleScriptString = command.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  await execFileAsync('/usr/bin/osascript', [
    '-e',
    `do shell script "${appleScriptString}" with administrator privileges`
  ])
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

function resolveHealth(
  registered: boolean,
  installed: boolean,
  problems: PiPackageProblem[]
): PiPackageHealth {
  if (problems.some((entry) => entry.code === 'PERMISSION_ERROR')) return 'permission-error'
  if (registered && !installed) return 'missing'
  if (!registered && installed) return 'orphaned'
  if (
    problems.some((entry) =>
      ['MANIFEST_MISSING', 'MANIFEST_INVALID', 'DEPENDENCY_MISSING', 'REGISTRY_MISMATCH'].includes(
        entry.code
      )
    )
  ) {
    return 'corrupted'
  }
  if (problems.some((entry) => entry.code === 'UNKNOWN_SOURCE')) return 'unknown'
  return 'healthy'
}

function problem(
  code: PiPackageProblem['code'],
  message: string,
  problemPath: string | null,
  recoverable = true
): PiPackageProblem {
  return { code, message, path: problemPath, recoverable }
}

function dedupeProblems(problems: PiPackageProblem[]): PiPackageProblem[] {
  const seen = new Set<string>()
  return problems.filter((entry) => {
    const key = `${entry.code}:${entry.path ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function removeRegistryPackage(packages: unknown, source: string, baseDir?: string): unknown[] {
  const values = Array.isArray(packages) ? packages : []
  const identity = packageIdentity(source, baseDir)
  return values.filter((entry) => {
    const value = typeof entry === 'string' ? entry : (entry as { source?: unknown })?.source
    return typeof value !== 'string' || packageIdentity(value, baseDir) !== identity
  })
}

export function packageNameFromSource(source: string): string {
  if (!source.startsWith('npm:')) return path.basename(source)
  const spec = source.slice(4)
  if (spec.startsWith('@')) {
    const slash = spec.indexOf('/')
    const versionAt = slash >= 0 ? spec.indexOf('@', slash) : -1
    return versionAt >= 0 ? spec.slice(0, versionAt) : spec
  }
  const versionAt = spec.lastIndexOf('@')
  return versionAt > 0 ? spec.slice(0, versionAt) : spec
}

export function packageIdentity(source: string, baseDir?: string): string {
  if (source.startsWith('npm:')) return `npm:${packageNameFromSource(source).toLowerCase()}`
  const git = parseGitSource(source)
  if (git) return `git:${git.host.toLowerCase()}/${git.packagePath.toLowerCase()}`
  const localPath = baseDir
    ? path.resolve(baseDir, source)
    : path.isAbsolute(source)
      ? path.resolve(source)
      : source
  return `local:${process.platform === 'win32' ? localPath.toLowerCase() : localPath}`
}

export function packageId(scope: PiPackageScope, source: string, baseDir?: string): string {
  return `${scope}:${packageIdentity(source, baseDir)}`
}

export function resolveInstalledPackagePath(configDir: string, source: string): string | null {
  return resolvePackageSource(configDir, source).installPath
}

export function classifyPackageError(output: string): PiPackageActionResult['errorCode'] {
  return /\bEACCES\b|permission denied|operation not permitted|npm\s+error\s+syscall\s+rename/i.test(
    output
  )
    ? 'EACCES'
    : output.trim()
      ? 'PROCESS_FAILED'
      : null
}

function safeResourcePath(root: string, entry: string): string | null {
  const resolvedRoot = path.resolve(root)
  const target = path.resolve(resolvedRoot, entry)
  return target === resolvedRoot || target.startsWith(resolvedRoot + path.sep) ? target : null
}

async function walk(
  target: string,
  depth: number,
  visit: (itemPath: string, isDirectory: boolean) => Promise<void>
): Promise<void> {
  if (depth > 6) return
  const stat = await lstatOrNull(target)
  if (!stat || stat.isSymbolicLink()) return
  if (!stat.isDirectory()) {
    await visit(target, false)
    return
  }
  await visit(target, true)
  for (const entry of await readdirSafe(target)) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    await walk(path.join(target, entry.name), depth + 1, visit)
  }
}

async function hasAccess(target: string, mode: number): Promise<boolean> {
  try {
    await fs.access(target, mode)
    return true
  } catch {
    return false
  }
}

async function readdirSafe(target: string) {
  try {
    return await fs.readdir(target, { withFileTypes: true })
  } catch {
    return []
  }
}

async function lstatOrNull(target: string) {
  try {
    return await fs.lstat(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    return null
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim()))
    : []
}

async function pruneFiles(directory: string, retention: number): Promise<void> {
  const entries = await readdirSafe(directory)
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map(async (entry) => ({
        path: path.join(directory, entry.name),
        stat: await fs.stat(path.join(directory, entry.name))
      }))
  )
  files.sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs)
  await Promise.all(files.slice(retention).map((entry) => fs.rm(entry.path, { force: true })))
}

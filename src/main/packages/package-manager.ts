import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  AppSettings,
  PiPackageActionResult,
  PiPackageInfo,
  PiPackagePermission,
  PiPackageScope,
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
import {
  classifyPackageError,
  packageId,
  packageIdentity,
  parseGitSource,
  parseNpmSource,
  resolvePackageSource,
  type ResolvedPackageSource
} from './package-source'
import {
  findNestedPermissionProblem,
  inspectPackagePermission,
  repairForeignOwnershipWithMacAuthorization,
  repairOwnedPermissions,
  repairSingleOwnedPermission
} from './package-permissions'
import {
  dedupePackageProblems as dedupeProblems,
  discoverGitPackages,
  emptyPackageResources as EMPTY_RESOURCES,
  inspectPackageContents,
  looksLikePiPackage,
  packageProblem as problem,
  readGitOrigin,
  readPackageManifest as readManifest,
  resolvePackageHealth as resolveHealth,
  resourceFilterFromRegistry,
  topLevelNpmPackages,
  type ResourceFilter
} from './package-inspection'

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
      for (const candidate of candidates) reports.push(await inspectPackagePermission(candidate))
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
    resolved: ResolvedPackageSource,
    registered: boolean,
    resourceFilter?: ResourceFilter
  ): Promise<PiPackageInfo> {
    const id = packageId(scope.scope, source, scope.baseDir)
    const installPath = resolved.installPath
    const rootPermission = installPath ? await inspectPackagePermission(installPath) : null
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
    if (
      !source ||
      !PACKAGE_SOURCE_PATTERN.test(source) ||
      /[$<>\0\r\n]/.test(source) ||
      (source.startsWith('npm:') && !parseNpmSource(source)) ||
      ((source.startsWith('git:') || /^(?:https?|ssh|git):\/\//i.test(source)) &&
        !parseGitSource(source))
    ) {
      throw new ValidationError(`Invalid package source: ${source || '<empty>'}`)
    }
    if (!['global', 'project'].includes(target.scope)) {
      throw new ValidationError('Invalid package scope')
    }
    const localSource =
      path.isAbsolute(source) || source.startsWith('./') || source.startsWith('../')
    if (target.scope === 'project') {
      if (!target.projectRoot)
        throw new ValidationError('Project package target requires projectRoot')
      const projectRoot = this.access
        ? await this.access.assertAllowed(target.projectRoot, { mustExist: true })
        : path.resolve(target.projectRoot)
      if (localSource && this.access) {
        await this.access.assertAllowed(
          path.isAbsolute(source) ? source : path.resolve(projectRoot, source),
          { mustExist: true }
        )
      }
      return { source, scope: 'project', projectRoot }
    }
    if (localSource) {
      if (!path.isAbsolute(source)) {
        throw new ValidationError('Global local package sources must use an absolute path')
      }
      if (this.access) await this.access.assertAllowed(source, { mustExist: true })
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

function removeRegistryPackage(packages: unknown, source: string, baseDir?: string): unknown[] {
  const values = Array.isArray(packages) ? packages : []
  const identity = packageIdentity(source, baseDir)
  return values.filter((entry) => {
    const value = typeof entry === 'string' ? entry : (entry as { source?: unknown })?.source
    return typeof value !== 'string' || packageIdentity(value, baseDir) !== identity
  })
}

export {
  classifyPackageError,
  packageId,
  packageIdentity,
  packageNameFromSource,
  resolveInstalledPackagePath
} from './package-source'

async function readdirSafe(target: string) {
  try {
    return await fs.readdir(target, { withFileTypes: true })
  } catch {
    return []
  }
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

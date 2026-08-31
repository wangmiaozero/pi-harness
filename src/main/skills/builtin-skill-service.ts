import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  AppSettings,
  BuiltinSkillActionResult,
  BuiltinSkillHealth,
  BuiltinSkillInfo,
  BuiltinSkillInstallation,
  BuiltinSkillMarketCollection,
  BuiltinSkillMutationTarget,
  PiPackageScope,
  SkillInfo
} from '@shared/ipc/api-types'
import type { AppMetadata, BuiltinSkillOwnership } from '../services/metadata-store'
import type { JsonStore } from '../services/storage'
import type { FileAccessService } from '../files/file-access-service'
import { piEnvironment } from '../pi/environment'
import { parseSkillDirectory } from '../capabilities/skill-parser'
import { builtinSkillsRoot, capabilityBackupDir } from '../services/app-paths'
import { AppError, SkillMutationError, ValidationError } from '../services/errors'
import { log } from '../services/logger'
import { findBuiltinSkillBundle } from '@shared/skills/builtin-bundles'
import {
  BUILTIN_SKILL_SOURCES,
  hashSkillDirectory,
  isSafeBuiltinSkillSegment as isSafeSegment,
  scanBuiltinSkillSource,
  type ScannedBuiltinSkill,
  type ScannedBuiltinSource
} from './builtin-skill-source'

export {
  BUILTIN_SKILL_CATEGORIES,
  BUILTIN_SKILL_SOURCES,
  hashSkillDirectory,
  scanBuiltinSkillSource
} from './builtin-skill-source'

interface ScopeContext {
  scope: PiPackageScope
  projectRoot: string | null
  root: string
}

interface BuiltinSkillServiceDependencies {
  sourceRoot: () => string
  backupRoot: () => string
  now: () => Date
  uuid: () => string
}

const defaults: BuiltinSkillServiceDependencies = {
  sourceRoot: builtinSkillsRoot,
  backupRoot: capabilityBackupDir,
  now: () => new Date(),
  uuid: randomUUID
}

export class BuiltinSkillService {
  private readonly dependencies: BuiltinSkillServiceDependencies
  private readonly mutations = new Set<string>()

  constructor(
    private readonly settingsStore: JsonStore<AppSettings>,
    private readonly metadataStore: JsonStore<AppMetadata>,
    private readonly access?: FileAccessService,
    dependencies: Partial<BuiltinSkillServiceDependencies> = {}
  ) {
    this.dependencies = { ...defaults, ...dependencies }
  }

  async list(projectRoot?: string | null): Promise<BuiltinSkillMarketCollection[]> {
    const contexts = await this.scopeContexts(projectRoot)
    const sources = await this.scanSources()
    return Promise.all(
      sources.map(async (source) => ({
        id: source.manifest.id,
        kind: 'builtin-skills' as const,
        name: source.manifest.name,
        displayName: source.manifest.displayName,
        author: source.manifest.author,
        repository: source.manifest.repository,
        license: source.manifest.license,
        commit: source.manifest.commit,
        source: 'builtin' as const,
        skills: await Promise.all(
          source.skills.map(async (skill): Promise<BuiltinSkillInfo> => ({
            id: skill.id,
            name: skill.name,
            description: skill.description,
            collectionId: source.manifest.id,
            category: skill.category,
            source: 'builtin',
            sourceRepository: source.manifest.repository,
            sourcePath: skill.sourcePath,
            bundledPath: skill.bundledPath,
            bundledHash: skill.bundledHash,
            bundledHealthy: skill.bundledHealthy,
            commit: source.manifest.commit,
            resources: skill.resources,
            installations: await Promise.all(
              contexts.map((context) => this.inspectInstallation(source, skill, context))
            )
          }))
        )
      }))
    )
  }

  async decorateInstalledSkills(skills: SkillInfo[]): Promise<SkillInfo[]> {
    const ownershipByPath = new Map<string, BuiltinSkillOwnership>()
    for (const ownership of Object.values(this.ownershipRecords())) {
      ownershipByPath.set(normalizePathIdentity(ownership.installedPath), ownership)
    }
    if (!ownershipByPath.size) return skills

    const sources = await this.scanSources().catch(() => [])
    const sourceByKey = new Map<
      string,
      { source: ScannedBuiltinSource; skill: ScannedBuiltinSkill }
    >()
    for (const source of sources) {
      for (const skill of source.skills) {
        sourceByKey.set(`${source.manifest.id}\0${skill.id}`, { source, skill })
      }
    }

    return Promise.all(
      skills.map(async (skill) => {
        if (skill.origin === 'package') return skill
        const ownership = ownershipByPath.get(normalizePathIdentity(skill.path))
        if (!ownership) return skill
        const bundled = sourceByKey.get(`${ownership.collectionId}\0${ownership.skillId}`)
        if (!bundled) {
          return {
            ...skill,
            origin: 'builtin' as const,
            builtinCollectionId: ownership.collectionId,
            builtinCategory: ownership.category,
            builtinHealth: 'corrupted' as const
          }
        }
        const installedHash = await hashSkillDirectory(skill.path).catch(() => null)
        const modified = Boolean(installedHash && installedHash.hash !== ownership.sourceHash)
        const updateAvailable =
          ownership.sourceCommit !== bundled.source.manifest.commit ||
          ownership.sourceHash !== bundled.skill.bundledHash
        return {
          ...skill,
          origin: 'builtin',
          builtinCollectionId: ownership.collectionId,
          builtinCollectionName: bundled.source.manifest.name,
          builtinCategory: ownership.category,
          builtinRepository: bundled.source.manifest.repository,
          bundledPath: bundled.skill.bundledPath,
          bundledCommit: bundled.source.manifest.commit,
          builtinHealth: !installedHash
            ? 'corrupted'
            : modified
              ? 'modified'
              : updateAvailable
                ? 'update-available'
                : 'healthy'
        }
      })
    )
  }

  ownershipTargetForPath(skillPath: string): BuiltinSkillMutationTarget | null {
    const identity = normalizePathIdentity(skillPath)
    const ownership = Object.values(this.ownershipRecords()).find(
      (record) => normalizePathIdentity(record.installedPath) === identity
    )
    if (!ownership) return null
    return {
      collectionId: ownership.collectionId,
      skillIds: [ownership.skillId],
      scope: ownership.scope,
      projectRoot: ownership.projectRoot
    }
  }

  async install(target: BuiltinSkillMutationTarget): Promise<BuiltinSkillActionResult[]> {
    return this.mutateCollection(target, 'install')
  }

  async update(target: BuiltinSkillMutationTarget): Promise<BuiltinSkillActionResult[]> {
    return this.mutateCollection({ ...target, overwrite: true }, 'update')
  }

  async uninstall(target: BuiltinSkillMutationTarget): Promise<BuiltinSkillActionResult[]> {
    return this.mutateCollection(target, 'uninstall')
  }

  private async mutateCollection(
    target: BuiltinSkillMutationTarget,
    action: BuiltinSkillActionResult['action']
  ): Promise<BuiltinSkillActionResult[]> {
    const normalized = await this.normalizeTarget(target, action !== 'uninstall')
    const bundle = findBuiltinSkillBundle(normalized.collectionId)
    const sources = new Map(
      (await this.scanSources()).map((source) => [source.manifest.id, source])
    )
    return this.mutateMany(normalized, action, (skillId) => {
      const sourceId = bundle
        ? bundle.members.find((member) => member.skillId === skillId)?.collectionId
        : normalized.collectionId
      const source = sourceId ? sources.get(sourceId) : undefined
      if (!source)
        throw new SkillMutationError('SKILL_NOT_FOUND', 'Skill is not a member of this collection')
      const canonicalTarget = {
        ...normalized,
        collectionId: source.manifest.id,
        skillIds: [skillId]
      }
      return action === 'uninstall'
        ? this.uninstallOne(source, skillId, canonicalTarget)
        : this.installOne(source, skillId, canonicalTarget, action)
    })
  }

  private async mutateMany(
    target: BuiltinSkillMutationTarget,
    action: BuiltinSkillActionResult['action'],
    operation: (skillId: string) => Promise<BuiltinSkillActionResult>
  ): Promise<BuiltinSkillActionResult[]> {
    const results: BuiltinSkillActionResult[] = []
    for (const skillId of target.skillIds) {
      const key = ownershipKey(
        // Different collections can target the same installed directory.
        'builtin',
        skillId,
        target.scope,
        target.projectRoot ?? null
      )
      if (this.mutations.has(key)) {
        results.push(
          failedResult(
            target,
            skillId,
            action,
            new SkillMutationError('PROCESS_FAILED', 'Built-in Skill operation is already running')
          )
        )
        continue
      }
      this.mutations.add(key)
      try {
        results.push(await operation(skillId))
      } catch (error) {
        results.push(failedResult(target, skillId, action, error))
      } finally {
        this.mutations.delete(key)
      }
    }
    return results
  }

  private async installOne(
    source: ScannedBuiltinSource,
    skillId: string,
    target: BuiltinSkillMutationTarget,
    action: 'install' | 'update' = 'install'
  ): Promise<BuiltinSkillActionResult> {
    const skill = source.skills.find((entry) => entry.id === skillId)
    if (!skill) throw new SkillMutationError('SKILL_NOT_FOUND', 'Bundled Skill was not found')
    if (!skill.bundledHealthy) {
      throw new SkillMutationError('SKILL_INVALID', 'Bundled Skill failed integrity validation')
    }

    const context = await this.resolveMutationContext(target)
    const destination = safeSkillChild(context.root, skill.id)
    const key = ownershipKey(source.manifest.id, skill.id, context.scope, context.projectRoot)
    const ownership = this.ownershipRecords()[key]
    const previousPathOwner = Object.entries(this.ownershipRecords()).find(
      ([otherKey, record]) =>
        otherKey !== key &&
        normalizePathIdentity(record.installedPath) === normalizePathIdentity(destination)
    )
    const existing = await lstatOrNull(destination)
    const logs: BuiltinSkillActionResult['logs'] = [
      {
        phase: 'resolve',
        ok: true,
        message: 'Resolved bundled Skill source',
        path: skill.bundledPath
      },
      {
        phase: 'target',
        ok: true,
        message: `Resolved ${context.scope} Skill root`,
        path: context.root
      }
    ]

    if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) {
      throw new SkillMutationError('SKILL_CONFLICT', 'Target path is not a real Skill directory', {
        path: destination
      })
    }
    if (existing && !ownership && !target.overwrite) {
      throw new SkillMutationError(
        'SKILL_CONFLICT',
        `A different Skill already exists at ${destination}`,
        { path: destination, conflict: 'unowned' }
      )
    }
    if (existing && ownership && !target.overwrite) {
      const installedHash = await hashSkillDirectory(destination)
      if (
        installedHash.hash === skill.bundledHash &&
        ownership.sourceCommit === source.manifest.commit
      ) {
        return successResult(
          target,
          skill.id,
          action,
          true,
          'Skill is already installed',
          destination,
          null,
          logs
        )
      }
      throw new SkillMutationError(
        'SKILL_CONFLICT',
        'Installed Skill differs from the bundled source; explicit overwrite is required',
        { path: destination, conflict: 'modified-or-update' }
      )
    }

    await ensureRealDirectory(context.root)
    await assertContextRoot(context)
    const bundledHash = await hashSkillDirectory(skill.bundledPath)
    if (bundledHash.hash !== skill.bundledHash) {
      throw new SkillMutationError('SKILL_INVALID', 'Bundled Skill changed after it was scanned')
    }

    const incoming = path.join(context.root, `.${skill.id}.install-${this.dependencies.uuid()}`)
    const rollback = path.join(context.root, `.${skill.id}.rollback-${this.dependencies.uuid()}`)
    let backupPath: string | null = null
    let movedExisting = false
    let installed = false
    await fs.cp(skill.bundledPath, incoming, { recursive: true, errorOnExist: true })
    try {
      const staged = await hashSkillDirectory(incoming)
      if (staged.hash !== skill.bundledHash || !(await parseSkillDirectory(incoming))) {
        throw new SkillMutationError('SKILL_INVALID', 'Staged Skill failed validation')
      }
      logs.push({
        phase: 'stage',
        ok: true,
        message: 'Copied and validated complete Skill directory'
      })

      if (existing) {
        backupPath = await this.backup(destination, skill.id, action)
        logs.push({
          phase: 'backup',
          ok: true,
          message: 'Existing Skill backup created',
          path: backupPath
        })
        await fs.rename(destination, rollback)
        movedExisting = true
      }
      await fs.rename(incoming, destination)
      installed = true
      const finalHash = await hashSkillDirectory(destination)
      const parsed = await parseSkillDirectory(destination)
      if (!parsed || finalHash.hash !== skill.bundledHash) {
        throw new SkillMutationError('SKILL_INVALID', 'Installed Skill failed final validation')
      }
      logs.push({
        phase: 'install',
        ok: true,
        message: 'Installed Skill directory atomically',
        path: destination
      })

      const nextOwnership: BuiltinSkillOwnership = {
        collectionId: source.manifest.id,
        skillId: skill.id,
        category: skill.category,
        scope: context.scope,
        projectRoot: context.projectRoot,
        installedPath: destination,
        sourcePath: skill.sourcePath,
        installedAt: this.dependencies.now().toISOString(),
        sourceCommit: source.manifest.commit,
        sourceHash: skill.bundledHash
      }
      await this.setOwnership(key, nextOwnership)
      logs.push({ phase: 'ownership', ok: true, message: 'Recorded built-in source ownership' })
      await fs.rm(rollback, { recursive: true, force: true }).catch(() => undefined)
      logs.push({ phase: 'verify', ok: true, message: 'Skill files and ownership verified' })
      log.skills.info('built-in Skill installed', {
        collection: source.manifest.id,
        skill: skill.id,
        scope: context.scope
      })
      return successResult(
        target,
        skill.id,
        action,
        false,
        action === 'update' ? 'Skill updated' : 'Skill installed',
        destination,
        backupPath,
        logs
      )
    } catch (error) {
      if (installed)
        await fs.rm(destination, { recursive: true, force: true }).catch(() => undefined)
      if (movedExisting) await fs.rename(rollback, destination).catch(() => undefined)
      if (ownership) await this.setOwnership(key, ownership).catch(() => undefined)
      else await this.setOwnership(key, null).catch(() => undefined)
      if (previousPathOwner) await this.setOwnership(...previousPathOwner).catch(() => undefined)
      throw error
    } finally {
      await fs.rm(incoming, { recursive: true, force: true }).catch(() => undefined)
      if (!movedExisting || installed) {
        await fs.rm(rollback, { recursive: true, force: true }).catch(() => undefined)
      }
    }
  }

  private async uninstallOne(
    source: ScannedBuiltinSource,
    skillId: string,
    target: BuiltinSkillMutationTarget
  ): Promise<BuiltinSkillActionResult> {
    const skill = source.skills.find((entry) => entry.id === skillId)
    if (!skill) throw new SkillMutationError('SKILL_NOT_FOUND', 'Bundled Skill was not found')
    const context = await this.resolveMutationContext(target)
    const expectedPath = safeSkillChild(context.root, skill.id)
    const key = ownershipKey(source.manifest.id, skill.id, context.scope, context.projectRoot)
    const ownership = this.ownershipRecords()[key]
    if (!ownership) {
      throw new SkillMutationError(
        'SKILL_CONFLICT',
        'Refusing to remove a Skill without matching built-in ownership'
      )
    }
    if (normalizePathIdentity(ownership.installedPath) !== normalizePathIdentity(expectedPath)) {
      throw new SkillMutationError(
        'SKILL_PATH_INVALID',
        'Ownership path does not match Skill target'
      )
    }

    const logs: BuiltinSkillActionResult['logs'] = [
      { phase: 'ownership', ok: true, message: 'Verified built-in Skill ownership' }
    ]
    const stat = await lstatOrNull(expectedPath)
    if (!stat) {
      await this.setOwnership(key, null)
      logs.push({
        phase: 'remove-record',
        ok: true,
        message: 'Removed missing Skill ownership record'
      })
      logs.push({ phase: 'verify', ok: true, message: 'Skill remains uninstalled' })
      return successResult(
        target,
        skill.id,
        'uninstall',
        false,
        'Missing Skill ownership removed',
        null,
        null,
        logs
      )
    }
    await assertContextRoot(context)
    await assertRealSkillDirectory(context.root, expectedPath)
    const backupPath = await this.backup(expectedPath, skill.id, 'uninstall')
    logs.push({
      phase: 'backup',
      ok: true,
      message: 'Installed Skill backup created',
      path: backupPath
    })
    await fs.rm(expectedPath, { recursive: true, force: false })
    try {
      await this.setOwnership(key, null)
    } catch (error) {
      await fs
        .cp(backupPath, expectedPath, { recursive: true, errorOnExist: true })
        .catch(() => undefined)
      throw error
    }
    if (await lstatOrNull(expectedPath)) {
      await this.setOwnership(key, ownership).catch(() => undefined)
      throw new SkillMutationError('SKILL_INSTALL_FAILED', 'Skill files remain after uninstall')
    }
    logs.push({
      phase: 'remove',
      ok: true,
      message: 'Removed installed Skill instance',
      path: expectedPath
    })
    logs.push({
      phase: 'verify',
      ok: true,
      message: 'Bundled source retained; installed instance removed'
    })
    log.skills.info('built-in Skill uninstalled', {
      collection: source.manifest.id,
      skill: skill.id,
      scope: context.scope
    })
    return successResult(
      target,
      skill.id,
      'uninstall',
      false,
      'Skill uninstalled',
      null,
      backupPath,
      logs
    )
  }

  private async inspectInstallation(
    source: ScannedBuiltinSource,
    skill: ScannedBuiltinSkill,
    context: ScopeContext
  ): Promise<BuiltinSkillInstallation> {
    const installedPath = safeSkillChild(context.root, skill.id)
    const key = ownershipKey(source.manifest.id, skill.id, context.scope, context.projectRoot)
    const ownership = this.ownershipRecords()[key]
    const stat = await lstatOrNull(installedPath)
    if (!ownership) {
      return {
        scope: context.scope,
        projectRoot: context.projectRoot,
        installedPath,
        installedAt: null,
        sourceCommit: '',
        sourceHash: '',
        installedHash: null,
        installed: false,
        owned: false,
        modified: false,
        updateAvailable: false,
        health: stat ? 'conflict' : skill.bundledHealthy ? 'not-installed' : 'corrupted'
      }
    }
    const ownershipValid =
      ownership.collectionId === source.manifest.id &&
      ownership.skillId === skill.id &&
      ownership.scope === context.scope &&
      normalizePathIdentity(ownership.installedPath) === normalizePathIdentity(installedPath)
    if (!ownershipValid || !skill.bundledHealthy) {
      return installationFromOwnership(ownership, context, installedPath, {
        installed: Boolean(stat),
        health: 'corrupted'
      })
    }
    if (!stat) {
      return installationFromOwnership(ownership, context, installedPath, {
        installed: false,
        health: 'missing'
      })
    }
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      !(await parseSkillDirectory(installedPath))
    ) {
      return installationFromOwnership(ownership, context, installedPath, {
        installed: true,
        health: 'corrupted'
      })
    }
    const installedHash = await hashSkillDirectory(installedPath).catch(() => null)
    if (!installedHash) {
      return installationFromOwnership(ownership, context, installedPath, {
        installed: true,
        health: 'corrupted'
      })
    }
    const modified = installedHash.hash !== ownership.sourceHash
    const updateAvailable =
      ownership.sourceCommit !== source.manifest.commit ||
      ownership.sourceHash !== skill.bundledHash
    const health: BuiltinSkillHealth = modified
      ? 'modified'
      : updateAvailable
        ? 'update-available'
        : 'healthy'
    return {
      scope: context.scope,
      projectRoot: context.projectRoot,
      installedPath,
      installedAt: ownership.installedAt,
      sourceCommit: ownership.sourceCommit,
      sourceHash: ownership.sourceHash,
      installedHash: installedHash.hash,
      installed: true,
      owned: true,
      modified,
      updateAvailable,
      health
    }
  }

  private async scanSources(): Promise<ScannedBuiltinSource[]> {
    const root = path.resolve(this.dependencies.sourceRoot())
    return Promise.all(
      BUILTIN_SKILL_SOURCES.map((definition) =>
        scanBuiltinSkillSource(path.join(root, definition.directory), definition.id)
      )
    )
  }

  private async scopeContexts(projectRoot?: string | null): Promise<ScopeContext[]> {
    const settings = this.settingsStore.peek()
    const environment = await piEnvironment.detect({
      cliPath: settings.manualCliPath,
      configDir: settings.manualConfigDir
    })
    if (!environment.configDir) {
      throw new SkillMutationError('SKILL_PATH_INVALID', 'Pi configuration directory is unknown')
    }
    const contexts: ScopeContext[] = [
      { scope: 'global', projectRoot: null, root: path.join(environment.configDir, 'skills') }
    ]
    if (projectRoot) {
      const resolvedProject = path.resolve(projectRoot)
      contexts.push({
        scope: 'project',
        projectRoot: resolvedProject,
        root: path.join(resolvedProject, '.pi', 'skills')
      })
    }
    return contexts
  }

  private async resolveMutationContext(target: BuiltinSkillMutationTarget): Promise<ScopeContext> {
    const contexts = await this.scopeContexts(target.projectRoot)
    const context = contexts.find((entry) => entry.scope === target.scope)
    if (!context) throw new ValidationError('Project scope requires a current project root')
    if (context.scope === 'project') {
      if (!context.projectRoot) throw new ValidationError('Project root is required')
      await this.access?.assertAllowed(context.projectRoot, { mustExist: true })
    }
    return context
  }

  private async normalizeTarget(
    target: BuiltinSkillMutationTarget,
    allowOverwrite: boolean
  ): Promise<BuiltinSkillMutationTarget> {
    const collectionId = target.collectionId.trim()
    if (
      !BUILTIN_SKILL_SOURCES.some((source) => source.id === collectionId) &&
      !findBuiltinSkillBundle(collectionId)
    ) {
      throw new ValidationError('Unknown built-in Skills Collection')
    }
    const skillIds = [...new Set(target.skillIds.map((id) => id.trim()))]
    if (!skillIds.length || skillIds.length > 100 || skillIds.some((id) => !isSafeSegment(id))) {
      throw new ValidationError('Choose between 1 and 100 valid built-in Skills')
    }
    if (target.scope === 'project' && !target.projectRoot) {
      throw new ValidationError('Project root is required for project Skill installation')
    }
    return {
      collectionId,
      skillIds,
      scope: target.scope,
      projectRoot: target.scope === 'project' ? path.resolve(target.projectRoot!) : null,
      overwrite: allowOverwrite && target.overwrite === true
    }
  }

  private ownershipRecords(): Record<string, BuiltinSkillOwnership> {
    const manifest = this.metadataStore.peek().builtinSkills
    return manifest?.installed && typeof manifest.installed === 'object' ? manifest.installed : {}
  }

  private async setOwnership(key: string, value: BuiltinSkillOwnership | null): Promise<void> {
    const installed = { ...this.ownershipRecords() }
    if (value) {
      // An explicitly confirmed replacement transfers ownership of this path.
      // Keeping the former source's record could later uninstall the new skill.
      for (const [otherKey, record] of Object.entries(installed)) {
        if (
          otherKey !== key &&
          normalizePathIdentity(record.installedPath) === normalizePathIdentity(value.installedPath)
        ) {
          delete installed[otherKey]
        }
      }
      installed[key] = value
    } else delete installed[key]
    await this.metadataStore.update({
      builtinSkills: { schemaVersion: 1, installed }
    })
  }

  private async backup(source: string, skillId: string, action: string): Promise<string> {
    const stamp = this.dependencies.now().toISOString().replace(/[:.]/g, '-')
    const destination = path.join(
      this.dependencies.backupRoot(),
      `${stamp}-builtin-${action}-${skillId}-${this.dependencies.uuid()}`
    )
    await fs.mkdir(path.dirname(destination), { recursive: true })
    await fs.cp(source, destination, { recursive: true, errorOnExist: true })
    return destination
  }
}

function installationFromOwnership(
  ownership: BuiltinSkillOwnership,
  context: ScopeContext,
  installedPath: string,
  state: { installed: boolean; health: BuiltinSkillHealth }
): BuiltinSkillInstallation {
  return {
    scope: context.scope,
    projectRoot: context.projectRoot,
    installedPath,
    installedAt: ownership.installedAt,
    sourceCommit: ownership.sourceCommit,
    sourceHash: ownership.sourceHash,
    installedHash: null,
    installed: state.installed,
    owned: true,
    modified: false,
    updateAvailable: false,
    health: state.health
  }
}

function ownershipKey(
  collectionId: string,
  skillId: string,
  scope: PiPackageScope,
  projectRoot: string | null
): string {
  return JSON.stringify([
    collectionId,
    skillId,
    scope,
    projectRoot ? normalizePathIdentity(projectRoot) : null
  ])
}

function safeSkillChild(root: string, skillId: string): string {
  if (!isSafeSegment(skillId)) {
    throw new SkillMutationError('SKILL_PATH_INVALID', 'Invalid built-in Skill id')
  }
  const resolvedRoot = path.resolve(root)
  const child = path.resolve(resolvedRoot, skillId)
  if (child === resolvedRoot || !child.startsWith(resolvedRoot + path.sep)) {
    throw new SkillMutationError('SKILL_PATH_INVALID', 'Skill path escapes its target root')
  }
  return child
}

async function ensureRealDirectory(root: string): Promise<void> {
  await fs.mkdir(root, { recursive: true })
  const stat = await fs.lstat(root)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new SkillMutationError('SKILL_PATH_INVALID', 'Pi Skill root must be a real directory')
  }
}

async function assertContextRoot(context: ScopeContext): Promise<void> {
  if (context.scope !== 'project' || !context.projectRoot) return
  const [realProject, realRoot] = await Promise.all([
    fs.realpath(context.projectRoot),
    fs.realpath(context.root)
  ])
  if (realRoot !== realProject && !realRoot.startsWith(realProject + path.sep)) {
    throw new SkillMutationError('SKILL_PATH_INVALID', 'Project Skill root escapes the project')
  }
}

async function assertRealSkillDirectory(root: string, target: string): Promise<void> {
  const resolvedRoot = path.resolve(root)
  const resolvedTarget = path.resolve(target)
  if (path.dirname(resolvedTarget) !== resolvedRoot) {
    throw new SkillMutationError('SKILL_PATH_INVALID', 'Skill is not a direct child of its root')
  }
  const [rootStat, targetStat] = await Promise.all([
    fs.lstat(resolvedRoot),
    fs.lstat(resolvedTarget)
  ])
  if (
    !rootStat.isDirectory() ||
    rootStat.isSymbolicLink() ||
    !targetStat.isDirectory() ||
    targetStat.isSymbolicLink()
  ) {
    throw new SkillMutationError('SKILL_PATH_INVALID', 'Skill paths must be real directories')
  }
  const [realRoot, realTarget] = await Promise.all([
    fs.realpath(resolvedRoot),
    fs.realpath(resolvedTarget)
  ])
  if (path.dirname(realTarget) !== realRoot) {
    throw new SkillMutationError('SKILL_PATH_INVALID', 'Skill path escapes its configured root')
  }
}

function successResult(
  target: BuiltinSkillMutationTarget,
  skillId: string,
  action: BuiltinSkillActionResult['action'],
  skipped: boolean,
  message: string,
  installedPath: string | null,
  backupPath: string | null,
  logs: BuiltinSkillActionResult['logs']
): BuiltinSkillActionResult {
  return {
    collectionId: target.collectionId,
    skillId,
    scope: target.scope,
    action,
    ok: true,
    skipped,
    message,
    installedPath,
    backupPath,
    errorCode: null,
    logs
  }
}

function failedResult(
  target: BuiltinSkillMutationTarget,
  skillId: string,
  action: BuiltinSkillActionResult['action'],
  error: unknown
): BuiltinSkillActionResult {
  const appError = error instanceof AppError ? error : null
  return {
    collectionId: target.collectionId,
    skillId,
    scope: target.scope,
    action,
    ok: false,
    skipped: false,
    message: error instanceof Error ? error.message : String(error),
    installedPath: null,
    backupPath: null,
    errorCode: appError?.code ?? 'SKILL_INSTALL_FAILED',
    logs: [
      {
        phase: action,
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      }
    ]
  }
}

function normalizePathIdentity(value: string): string {
  const resolved = path.resolve(value)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

async function lstatOrNull(target: string): Promise<Awaited<ReturnType<typeof fs.lstat>> | null> {
  try {
    return await fs.lstat(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

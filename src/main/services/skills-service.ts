/**
 * SkillsService — discover, inspect, edit and create Pi skill directories.
 *
 * Pi skill layout (per Pi Coding Agent conventions):
 *   <skillDir>/<skill-name>/SKILL.md   (markdown body)
 *
 * Security:
 *   - All path operations resolve to absolute paths.
 *   - create / import / delete refuse paths outside the configured skill roots.
 *   - Symlink escape is prevented by lstat checks at parent boundaries.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  PiPackageActionResult,
  PiPackageCleanupPlan,
  PiPackageCleanupResult,
  PiPackageInfo,
  PiPackagePermission,
  PiPackageTarget,
  BuiltinSkillActionResult,
  BuiltinSkillMutationTarget,
  SkillInfo,
  SkillMarketCollection
} from '@shared/ipc/api-types'
import { piEnvironment } from '../pi/environment'
import { atomicWriteText, fileMtime, readTextFile } from './storage'
import { log } from './logger'
import type { AppSettings } from '@shared/ipc/api-types'
import type { JsonStore } from './storage'
import { AppError, ValidationError, FileSystemError, SkillConflictError } from './errors'
import { capabilityBackupDir } from './app-paths'
import { PiPackageManager, packageNameFromSource } from '../packages/package-manager'
import type { BuiltinSkillService } from '../skills/builtin-skill-service'

export interface SkillForm {
  name: string
  description: string
  /** Markdown body for SKILL.md. */
  content: string
  /** Target root directory (must be one of the discovered skill roots). */
  targetRoot: string
  /** Baseline mtime of SKILL.md when the editor opened. */
  expectedMtime?: number | null
  /** Force overwrite when disk changed externally. */
  overwrite?: boolean
}

export interface SkillValidationIssue {
  level: 'warning' | 'error'
  message: string
}

export interface SkillValidationResult {
  valid: boolean
  issues: SkillValidationIssue[]
}

const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/

interface MarketCatalogEntry {
  id: 'core-development' | 'agent-architecture' | 'curated-extensions'
  kind: 'bundle' | 'guide'
  sources: readonly string[]
}

const CORE_DEVELOPMENT_SOURCES = [
  'npm:pi-powerline-footer',
  'npm:pi-web-access',
  'npm:pi-subagents',
  'npm:@ff-labs/pi-fff',
  'npm:pi-markdown-preview',
  'npm:pi-cjk-markdown-fix',
  'npm:@dietrichgebert/ponytail'
] as const

const AGENT_ARCHITECTURE_SOURCES = [
  ...CORE_DEVELOPMENT_SOURCES,
  'npm:pi-mcp-adapter',
  'npm:pi-lean-ctx',
  'npm:pi-hermes-memory',
  'npm:pi-btw',
  'npm:pi-intercom',
  'npm:@gonrocca/zero-pi'
] as const

const COMMUNITY_EXTENSION_SOURCES = [
  'npm:pi-agent-mode',
  'npm:pi-crew',
  'npm:@baochunli/pi-collaborating-agents',
  'npm:pi-sub-agent',
  'npm:pi-mcp-extension',
  'npm:pi-lmstudio',
  'npm:@langchain/langsmith-pi-extension'
] as const

export const SKILL_MARKET_CATALOG: readonly MarketCatalogEntry[] = [
  { id: 'core-development', kind: 'bundle', sources: CORE_DEVELOPMENT_SOURCES },
  { id: 'agent-architecture', kind: 'bundle', sources: AGENT_ARCHITECTURE_SOURCES },
  {
    id: 'curated-extensions',
    kind: 'guide',
    sources: [...AGENT_ARCHITECTURE_SOURCES, 'npm:pi-antigravity', ...COMMUNITY_EXTENSION_SOURCES]
  }
]

const MARKET_PACKAGE_DESCRIPTIONS: Readonly<Record<string, string>> = {
  'npm:pi-cjk-markdown-fix': 'Improves CJK Markdown rendering in Pi.',
  'npm:pi-antigravity': 'Adds Antigravity model-provider integration for Pi.',
  'npm:pi-agent-mode': 'Switches between Markdown-defined agent modes with inline execution.',
  'npm:pi-crew': 'Coordinates agent teams, worktrees, workflows, and async tasks.',
  'npm:@baochunli/pi-collaborating-agents':
    'Shares messages and file reservations between collaborating agents.',
  'npm:pi-sub-agent': 'Adds a focused sub-agent tool and settings command.',
  'npm:pi-mcp-extension': 'Connects Pi to MCP servers through a full client extension.',
  'npm:pi-lmstudio': 'Connects Pi to local models served by LM Studio.',
  'npm:@langchain/langsmith-pi-extension': 'Traces Pi model and tool activity in LangSmith.'
}

export class SkillsService {
  private readonly knownProjectRoots = new Set<string>()

  constructor(
    private readonly settingsStore: JsonStore<AppSettings>,
    private readonly packageManager = new PiPackageManager(settingsStore),
    private readonly builtinSkills?: BuiltinSkillService
  ) {}

  async list(projectRoot?: string | null): Promise<SkillInfo[]> {
    const settings = this.settingsStore.peek()
    const env = await piEnvironment.detect({
      cliPath: settings.manualCliPath,
      configDir: settings.manualConfigDir
    })
    // PackageManager validates the project root before it is trusted by skill file operations.
    const packages = await this.packageManager.list(projectRoot)
    if (projectRoot) this.knownProjectRoots.add(path.resolve(projectRoot))
    const skillRoots = [
      ...env.skillsDirs,
      ...(projectRoot
        ? [
            path.join(path.resolve(projectRoot), '.pi', 'skills'),
            path.join(path.resolve(projectRoot), '.agents', 'skills')
          ]
        : [])
    ].filter((root, index, roots) => roots.indexOf(root) === index)
    const out: SkillInfo[] = []
    for (const dir of skillRoots) {
      const skills = await this.scanDir(
        dir,
        skillRoots,
        this.skillScope(dir, projectRoot, env.configDir)
      )
      out.push(...skills)
    }
    for (const pkg of packages) {
      if (!pkg.path || !pkg.installed) continue
      out.push(...(await this.scanPackageSkills(pkg)))
    }
    const unique = [
      ...new Map(out.map((skill) => [path.resolve(skill.path), skill])).values()
    ].sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path))
    return this.builtinSkills ? this.builtinSkills.decorateInstalledSkills(unique) : unique
  }

  /** Installed Pi packages, including their package-provided resources. */
  async listPackages(projectRoot?: string | null): Promise<PiPackageInfo[]> {
    const packages = await this.packageManager.list(projectRoot)
    if (projectRoot) this.knownProjectRoots.add(path.resolve(projectRoot))
    return packages
  }

  /** Curated, product-owned package catalog. Reference documents are never exposed at runtime. */
  async listMarket(projectRoot?: string | null): Promise<SkillMarketCollection[]> {
    const installed = await this.listPackages(projectRoot)
    const installedBySource = new Map(
      installed.filter((pkg) => pkg.registered).map((pkg) => [`${pkg.scope}:${pkg.source}`, pkg])
    )
    const installedByName = new Map(
      installed.filter((pkg) => pkg.registered).map((pkg) => [`${pkg.scope}:${pkg.name}`, pkg])
    )
    const packageCollections: SkillMarketCollection[] = SKILL_MARKET_CATALOG.map((collection) => ({
      id: collection.id,
      kind: collection.kind,
      packages: collection.sources.map((source) => {
        const name = packageNameFromSource(source)
        const match =
          installedBySource.get(`global:${source}`) ?? installedByName.get(`global:${name}`)
        return {
          source,
          name,
          description: match?.description || MARKET_PACKAGE_DESCRIPTIONS[source] || '',
          installed: Boolean(match),
          installedVersion: match?.version ?? null
        }
      })
    }))
    const builtinCollections = this.builtinSkills ? await this.builtinSkills.list(projectRoot) : []
    return [...builtinCollections, ...packageCollections]
  }

  async installBuiltinSkills(
    target: BuiltinSkillMutationTarget
  ): Promise<BuiltinSkillActionResult[]> {
    if (!this.builtinSkills) throw new ValidationError('Built-in Skills are unavailable')
    return this.builtinSkills.install(target)
  }

  async updateBuiltinSkills(
    target: BuiltinSkillMutationTarget
  ): Promise<BuiltinSkillActionResult[]> {
    if (!this.builtinSkills) throw new ValidationError('Built-in Skills are unavailable')
    return this.builtinSkills.update(target)
  }

  async uninstallBuiltinSkills(
    target: BuiltinSkillMutationTarget
  ): Promise<BuiltinSkillActionResult[]> {
    if (!this.builtinSkills) throw new ValidationError('Built-in Skills are unavailable')
    return this.builtinSkills.uninstall(target)
  }

  /** Install one or more marketplace sources, continuing after individual failures. */
  async installPackages(targets: PiPackageTarget[]): Promise<PiPackageActionResult[]> {
    const unique = uniqueTargets(targets)
    if (unique.length === 0 || unique.length > 50) {
      throw new ValidationError('Choose between 1 and 50 packages to install.')
    }
    const results: PiPackageActionResult[] = []
    for (const target of unique) {
      try {
        results.push(await this.packageManager.install(target))
      } catch (err) {
        results.push(failedPackageAction(target, 'install', err))
      }
    }
    log.skills.info(
      `package install finished: ${results.filter((result) => result.ok).length}/${results.length}`
    )
    return results
  }

  async repairPackage(target: PiPackageTarget): Promise<PiPackageActionResult> {
    return this.packageManager.install(target, 'repair')
  }

  async registerPackage(target: PiPackageTarget): Promise<PiPackageActionResult> {
    return this.packageManager.install(target, 'register')
  }

  async removePackage(target: PiPackageTarget): Promise<PiPackageActionResult> {
    return this.packageManager.uninstall(target)
  }

  async deleteOrphanPackage(target: PiPackageTarget): Promise<PiPackageActionResult> {
    return this.packageManager.deleteOrphan(target)
  }

  /** Remove multiple configured Pi packages, continuing after individual failures. */
  async removePackages(targets: PiPackageTarget[]): Promise<PiPackageActionResult[]> {
    const unique = uniqueTargets(targets)
    if (unique.length === 0 || unique.length > 50) {
      throw new ValidationError('Choose between 1 and 50 packages to remove.')
    }
    const results: PiPackageActionResult[] = []
    for (const target of unique) {
      try {
        results.push(await this.packageManager.uninstall(target))
      } catch (err) {
        results.push(failedPackageAction(target, 'uninstall', err))
      }
    }
    log.skills.info(
      `package removal finished: ${results.filter((result) => result.ok).length}/${results.length}`
    )
    return results
  }

  async cleanupPlan(projectRoot?: string | null): Promise<PiPackageCleanupPlan> {
    const [packages, skills] = await Promise.all([
      this.listPackages(projectRoot),
      this.list(projectRoot)
    ])
    const registered = packages.filter((pkg) => pkg.registered && pkg.sourceType !== 'builtin')
    const orphaned = packages.filter((pkg) => !pkg.registered && pkg.health === 'orphaned')
    const standaloneSkills = skills
      .filter((skill) => skill.origin === 'local' && !skill.readOnly)
      .map((skill) => ({ path: skill.path, name: skill.name, scope: skill.scope }))
    return {
      packages: registered.map(packageTarget),
      orphanPackages: orphaned.map(packageTarget),
      standaloneSkills,
      totals: {
        npm: registered.filter((pkg) => pkg.sourceType === 'npm').length,
        git: registered.filter((pkg) => pkg.sourceType === 'git').length,
        local: registered.filter((pkg) => pkg.sourceType === 'local').length,
        orphaned: orphaned.length,
        skills: standaloneSkills.length
      },
      preserved: [
        'providers and models',
        'API keys and credentials',
        'sessions and history',
        'Pi settings unrelated to packages',
        'Pi-Harness application settings'
      ]
    }
  }

  /** Recomputes the plan server-side; renderer-provided paths are never trusted. */
  async cleanupThirdParty(projectRoot?: string | null): Promise<PiPackageCleanupResult> {
    const plan = await this.cleanupPlan(projectRoot)
    const packageResults: PiPackageActionResult[] = []
    const removedSkills: string[] = []
    const failures: PiPackageCleanupResult['failures'] = []
    for (const target of plan.packages) {
      try {
        const result = await this.packageManager.uninstall(target)
        packageResults.push(result)
        if (!result.ok) failures.push({ target: target.source, message: result.message })
      } catch (error) {
        packageResults.push(failedPackageAction(target, 'uninstall', error))
        failures.push({ target: target.source, message: (error as Error).message })
      }
    }
    for (const target of plan.orphanPackages) {
      try {
        const result = await this.packageManager.deleteOrphan(target)
        packageResults.push(result)
        if (!result.ok) failures.push({ target: target.source, message: result.message })
      } catch (error) {
        packageResults.push(failedPackageAction(target, 'delete-orphan', error))
        failures.push({ target: target.source, message: (error as Error).message })
      }
    }
    for (const skill of plan.standaloneSkills) {
      try {
        await this.delete(skill.path)
        removedSkills.push(skill.path)
      } catch (error) {
        failures.push({ target: skill.path, message: (error as Error).message })
      }
    }
    return { plan, packageResults, removedSkills, failures }
  }

  async repairPermissions(projectRoot?: string | null): Promise<PiPackagePermission[]> {
    return this.packageManager.repairPermissions(projectRoot)
  }

  async read(skillPath: string): Promise<{ content: string; mtime: number | null }> {
    const resolved = path.resolve(skillPath)
    if (!['skill.md', 'readme.md'].includes(path.basename(resolved).toLowerCase())) {
      throw new ValidationError('Only SKILL.md and README.md can be read through the Skills API')
    }
    const allowedRoots = await this.allowedReadRoots()
    await this.assertReadablePath(resolved, allowedRoots)
    const text = await readTextFile(resolved)
    if (text === null) throw new FileSystemError(`Skill file not found: ${resolved}`)
    const mtime = await fileMtime(resolved)
    return { content: text, mtime }
  }

  async delete(skillPath: string): Promise<void> {
    const allowedRoots = await this.allowedRoots()
    const resolved = path.resolve(skillPath)
    const builtinTarget = this.builtinSkills?.ownershipTargetForPath(resolved)
    if (builtinTarget) {
      const [result] = await this.builtinSkills!.uninstall(builtinTarget)
      if (!result?.ok) {
        throw new AppError(
          result?.errorCode ?? 'SKILL_INSTALL_FAILED',
          result?.message ?? 'Built-in Skill uninstall failed'
        )
      }
      return
    }
    const root = allowedRoots.find(
      (candidate) => path.dirname(resolved) === path.resolve(candidate)
    )
    if (!root) {
      throw new ValidationError('Refusing to delete: expected a direct child of a skill root')
    }
    let stat: Awaited<ReturnType<typeof fs.lstat>>
    try {
      stat = await fs.lstat(resolved)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new FileSystemError(`Skill directory not found: ${resolved}`)
      }
      throw error
    }
    if (stat.isSymbolicLink()) {
      await fs.unlink(resolved)
      log.skills.info(`removed skill symlink ${resolved}`)
      return
    }
    if (!stat.isDirectory()) throw new ValidationError('Skill delete target must be a directory')
    const [realRoot, realTarget] = await Promise.all([fs.realpath(root), fs.realpath(resolved)])
    if (path.dirname(realTarget) !== realRoot) {
      throw new ValidationError('Refusing to delete: resolved path escapes the skill root')
    }
    const backupPath = await this.backupSkillDirectory(resolved, 'delete')
    await fs.rm(resolved, { recursive: true, force: true })
    log.skills.info('deleted skill with backup', { skill: resolved, backupPath })
  }

  /**
   * Create a new skill on disk:
   *   <targetRoot>/<name>/SKILL.md
   * Refuses to overwrite an existing skill; the caller may import+replace instead.
   */
  async create(form: SkillForm): Promise<SkillInfo> {
    const allowedRoots = await this.allowedRoots()
    this.assertKnownRoot(form.targetRoot, allowedRoots, 'create targetRoot')
    const validation = validateSkill(form)
    if (!validation.valid) {
      throw new ValidationError('Invalid skill', { issues: validation.issues })
    }
    const skillDir = path.resolve(form.targetRoot, form.name)
    if (
      skillDir !== path.resolve(form.targetRoot) &&
      !skillDir.startsWith(path.resolve(form.targetRoot) + path.sep)
    ) {
      throw new ValidationError(`Skill name escapes targetRoot: ${form.name}`)
    }
    // Reject if skill dir already exists (the caller may import+replace)
    if (await lstatOrNull(skillDir)) {
      throw new ValidationError(`Skill already exists: ${skillDir}`)
    }
    await fs.mkdir(skillDir, { recursive: true })
    const body = renderSkillMd(form)
    await atomicWriteText(path.join(skillDir, 'SKILL.md'), body)
    log.skills.info(`created skill ${form.name} at ${skillDir}`)
    return {
      name: form.name,
      description: form.description,
      path: skillDir,
      source: path.resolve(form.targetRoot),
      isValid: true,
      issues: [],
      lastModified: Date.now(),
      hasReadme: true,
      readOnly: false,
      origin: 'local'
    }
  }

  /**
   * Update the SKILL.md body of an existing skill.
   * Validates name + path; refuses paths outside allowed roots.
   * Detects external mtime conflicts unless `overwrite` is set.
   */
  async update(form: SkillForm): Promise<SkillInfo> {
    const allowedRoots = await this.allowedRoots()
    this.assertKnownRoot(form.targetRoot, allowedRoots, 'update targetRoot')
    const validation = validateSkill(form)
    if (!validation.valid) {
      throw new ValidationError('Invalid skill', { issues: validation.issues })
    }
    const skillDir = path.resolve(form.targetRoot, form.name)
    const skillMd = path.join(skillDir, 'SKILL.md')
    await this.assertWritableSkillDirectory(skillDir, allowedRoots)
    const currentMtime = await fileMtime(skillMd)
    if (
      form.expectedMtime != null &&
      !form.overwrite &&
      currentMtime != null &&
      currentMtime !== form.expectedMtime
    ) {
      throw new SkillConflictError('SKILL.md changed externally since it was loaded.', {
        path: skillMd,
        lastMtime: form.expectedMtime,
        currentMtime
      })
    }
    const body = renderSkillMd(form)
    await atomicWriteText(skillMd, body)
    log.skills.info(`updated skill ${form.name} at ${skillDir}`)
    return {
      name: form.name,
      description: form.description,
      path: skillDir,
      source: path.resolve(form.targetRoot),
      isValid: true,
      issues: [],
      lastModified: Date.now(),
      hasReadme: true,
      readOnly: false,
      origin: 'local'
    }
  }

  /**
   * Import a skill from a local folder or file. Options:
   *   mode: 'copy' (default) — copy the source into the target root under `name`
   *   onConflict: 'rename' | 'replace' | 'cancel'
   */
  async import(input: {
    source: string
    targetRoot: string
    name: string
    onConflict?: 'rename' | 'replace' | 'cancel'
  }): Promise<SkillInfo> {
    const allowedRoots = await this.allowedRoots()
    this.assertKnownRoot(input.targetRoot, allowedRoots, 'import targetRoot')
    if (!NAME_PATTERN.test(input.name)) {
      throw new ValidationError(`Invalid skill name: ${input.name}`)
    }
    const src = path.resolve(input.source)
    const dst = path.resolve(input.targetRoot, input.name)
    if (!(await fileMtime(src))) {
      throw new FileSystemError(`Source not found: ${src}`)
    }
    const srcStat = await fs.lstat(src)
    const skillMdSrc = srcStat.isDirectory() ? path.join(src, 'SKILL.md') : src
    const body = await readTextFile(skillMdSrc)
    if (body === null) {
      throw new ValidationError(`Source SKILL.md missing: ${skillMdSrc}`)
    }
    let finalName = input.name
    let finalDst = dst
    const dstStat = await lstatOrNull(dst)
    if (dstStat) {
      const policy = input.onConflict ?? 'cancel'
      if (policy === 'cancel') {
        throw new ValidationError(`Skill already exists at target: ${dst}`)
      }
      if (policy === 'rename') {
        finalName = await uniqueSkillName(input.targetRoot, input.name)
        finalDst = path.resolve(input.targetRoot, finalName)
      } else {
        if (!dstStat.isDirectory() || dstStat.isSymbolicLink()) {
          throw new ValidationError('Refusing to replace a non-directory or symbolic-link skill')
        }
        await this.assertWritableSkillDirectory(finalDst, allowedRoots)
        // Never remove the existing directory unless its backup completed.
        const backupPath = await this.backupSkillDirectory(finalDst, 'import-replace')
        log.skills.info(`backed up skill before replace: ${backupPath}`)
        await fs.rm(finalDst, { recursive: true, force: true })
      }
    }
    await fs.mkdir(finalDst, { recursive: true })
    await atomicWriteText(path.join(finalDst, 'SKILL.md'), body)
    log.skills.info(`imported skill ${finalName} → ${finalDst}`)
    return {
      name: finalName,
      description: extractDescription(body),
      path: finalDst,
      source: path.resolve(input.targetRoot),
      isValid: true,
      issues: [],
      lastModified: Date.now(),
      hasReadme: true,
      readOnly: false,
      origin: 'local'
    }
  }

  /** Run client-side validation only — does not touch disk. */
  validate(form: SkillForm): SkillValidationResult {
    return validateSkill(form)
  }

  private async scanPackageSkills(pkg: PiPackageInfo): Promise<SkillInfo[]> {
    if (!pkg.path) return []
    const skills: SkillInfo[] = []
    for (const resource of pkg.resourceItems.filter((item) => item.type === 'skill')) {
      const skillPath = resource.path
      const skillMd = path.join(skillPath, 'SKILL.md')
      const readmeText = await readTextFile(skillMd)
      if (readmeText === null) continue
      skills.push({
        name: path.basename(skillPath),
        description: extractDescription(readmeText),
        path: skillPath,
        source: pkg.path,
        isValid: true,
        issues: [],
        lastModified: await fileMtime(skillMd),
        hasReadme: true,
        readOnly: true,
        origin: 'package',
        packageSource: pkg.source,
        scope: pkg.scope,
        packageId: pkg.id,
        packageName: pkg.name,
        packageVersion: pkg.version,
        packageType: pkg.sourceType,
        packagePath: pkg.path,
        packageScope: pkg.scope,
        registryPath: pkg.registryPath
      })
    }
    return skills
  }

  private async allowedRoots(): Promise<string[]> {
    const settings = this.settingsStore.peek()
    const env = await piEnvironment.detect({
      cliPath: settings.manualCliPath,
      configDir: settings.manualConfigDir
    })
    return [
      ...env.skillsDirs,
      ...[...this.knownProjectRoots].flatMap((root) => [
        path.join(root, '.pi', 'skills'),
        path.join(root, '.agents', 'skills')
      ])
    ]
      .map((d) => path.resolve(d))
      .filter((root, index, roots) => roots.indexOf(root) === index)
  }

  private async backupSkillDirectory(source: string, action: string): Promise<string> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupPath = path.join(
      capabilityBackupDir(),
      `${stamp}-${action}-${path.basename(source)}-${randomUUID()}`
    )
    await fs.mkdir(path.dirname(backupPath), { recursive: true })
    await fs.cp(source, backupPath, { recursive: true, errorOnExist: true })
    return backupPath
  }

  private async allowedReadRoots(): Promise<string[]> {
    const roots = await this.allowedRoots()
    const packageGroups = await Promise.all([
      this.listPackages(),
      ...[...this.knownProjectRoots].map((root) => this.listPackages(root))
    ])
    const packages = packageGroups.flat()
    return [
      ...roots,
      ...packages
        .map((pkg) => pkg.path)
        .filter((packagePath): packagePath is string => Boolean(packagePath))
        .map((packagePath) => path.resolve(packagePath))
    ]
  }

  private async assertReadablePath(target: string, allowedRoots: string[]): Promise<void> {
    const resolved = path.resolve(target)
    const lexicalMatch = allowedRoots.some(
      (root) => resolved !== root && resolved.startsWith(path.resolve(root) + path.sep)
    )
    if (!lexicalMatch) {
      throw new ValidationError('Refusing to read: path outside skill and package roots')
    }
    let realTarget: string
    try {
      realTarget = await fs.realpath(resolved)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new FileSystemError(`Skill file not found: ${resolved}`)
      }
      throw error
    }
    const realRoots = await Promise.all(
      allowedRoots.map((root) => fs.realpath(root).catch(() => null))
    )
    const realMatch = realRoots.some(
      (root) => root && realTarget !== root && realTarget.startsWith(root + path.sep)
    )
    if (!realMatch) {
      throw new ValidationError('Refusing to read: symlink target outside skill and package roots')
    }
  }

  private assertKnownRoot(target: string, allowedRoots: string[], label: string): void {
    const resolved = path.resolve(target)
    const ok = allowedRoots.some((root) => resolved === path.resolve(root))
    if (!ok) {
      throw new ValidationError(`Refusing to ${label}: expected a configured skill root`)
    }
  }

  private async assertWritableSkillDirectory(
    target: string,
    allowedRoots: string[]
  ): Promise<void> {
    const resolved = path.resolve(target)
    if (!allowedRoots.some((root) => path.dirname(resolved) === path.resolve(root))) {
      throw new ValidationError('Refusing to write: expected a direct child of a skill root')
    }
    const targetStat = await lstatOrNull(resolved)
    if (!targetStat) throw new FileSystemError(`Skill directory not found: ${resolved}`)
    if (!targetStat.isDirectory() && !targetStat.isSymbolicLink()) {
      throw new ValidationError('Skill write target must be a directory')
    }
    const [realTarget, realTargetStat, realRoots] = await Promise.all([
      fs.realpath(resolved),
      fs.stat(resolved),
      Promise.all(allowedRoots.map((root) => fs.realpath(root).catch(() => null)))
    ])
    if (!realTargetStat.isDirectory()) {
      throw new ValidationError('Skill write target must resolve to a directory')
    }
    if (!realRoots.some((root) => root && path.dirname(realTarget) === root)) {
      throw new ValidationError('Refusing to write: symlink target outside skill roots')
    }
  }

  private skillScope(
    dir: string,
    projectRoot: string | null | undefined,
    configDir: string | null
  ): SkillInfo['scope'] {
    const resolved = path.resolve(dir)
    if (projectRoot && resolved.startsWith(path.resolve(projectRoot) + path.sep)) return 'project'
    if (configDir && resolved.startsWith(path.resolve(configDir) + path.sep)) return 'global'
    return 'shared'
  }

  private async scanDir(
    dir: string,
    allowedRoots: string[],
    scope: SkillInfo['scope']
  ): Promise<SkillInfo[]> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      const realRoots = (
        await Promise.all(allowedRoots.map((root) => fs.realpath(root).catch(() => null)))
      ).filter((root): root is string => Boolean(root))
      const skills: SkillInfo[] = []
      for (const ent of entries) {
        if (!ent.isDirectory() && !ent.isSymbolicLink()) continue
        if (ent.name.startsWith('.')) continue
        const skillPath = path.join(dir, ent.name)
        if (ent.isSymbolicLink()) {
          const realSkillPath = await fs.realpath(skillPath).catch(() => null)
          if (
            !realSkillPath ||
            !realRoots.some((root) => realSkillPath.startsWith(root + path.sep))
          ) {
            log.skills.warn(`ignored skill symlink outside configured roots: ${skillPath}`)
            continue
          }
        }
        const readme = path.join(skillPath, 'SKILL.md')
        const alt = path.join(skillPath, 'README.md')
        const readmeText = (await readTextFile(readme)) ?? (await readTextFile(alt))
        const hasReadme = readmeText !== null
        const description = extractDescription(readmeText)
        const issues: string[] = []
        if (!hasReadme) issues.push('Missing SKILL.md / README.md')
        skills.push({
          name: ent.name,
          description,
          path: skillPath,
          source: dir,
          isValid: issues.length === 0,
          issues,
          lastModified: await fileMtime(skillPath),
          hasReadme,
          readOnly: false,
          origin: 'local',
          scope
        })
      }
      return skills
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
      log.pi.debug(`skill dir scan failed (${dir}):`, err)
      return []
    }
  }
}

function extractDescription(md: string | null): string {
  if (!md) return ''
  const lines = md.split(/\r?\n/).map((l) => l.trim())
  let frontmatter = lines[0] === '---'
  for (let index = frontmatter ? 1 : 0; index < lines.length; index++) {
    const line = lines[index]
    if (frontmatter) {
      if (line === '---') frontmatter = false
      continue
    }
    if (!line || line.startsWith('#')) continue
    return line.slice(0, 200)
  }
  return ''
}

function validateSkill(form: SkillForm): SkillValidationResult {
  const issues: SkillValidationIssue[] = []
  if (!form.name || !NAME_PATTERN.test(form.name)) {
    issues.push({
      level: 'error',
      message: `Invalid skill name "${form.name}". Use lowercase letters, digits, '.', '_', '-'; start with alnum; max 64 chars.`
    })
  }
  if (!form.targetRoot) {
    issues.push({ level: 'error', message: 'Target root is required.' })
  }
  if (!form.content || form.content.trim().length < 8) {
    issues.push({ level: 'error', message: 'SKILL.md body is too short (min 8 chars).' })
  }
  if (!form.description) {
    issues.push({
      level: 'warning',
      message: 'Description is empty — the first non-heading line will be used.'
    })
  }
  // Disallow obvious traversal in name
  if (form.name.includes('..') || form.name.includes('/') || form.name.includes('\\')) {
    issues.push({ level: 'error', message: 'Skill name must not contain path separators.' })
  }
  return {
    valid: issues.every((i) => i.level !== 'error'),
    issues
  }
}

function renderSkillMd(form: SkillForm): string {
  const title = form.name
  const desc = form.description.trim()
  const body = form.content.trimEnd() + '\n'
  if (desc) {
    return `---\nname: ${title}\ndescription: ${desc}\n---\n\n${body}`
  }
  return `# ${title}\n\n${body}`
}

async function uniqueSkillName(targetRoot: string, base: string): Promise<string> {
  const root = path.resolve(targetRoot)
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`
    if (!(await lstatOrNull(path.join(root, candidate)))) return candidate
  }
  throw new ValidationError(`Unable to find free name for skill: ${base}`)
}

async function lstatOrNull(target: string): Promise<Awaited<ReturnType<typeof fs.lstat>> | null> {
  try {
    return await fs.lstat(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

function uniqueTargets(targets: PiPackageTarget[]): PiPackageTarget[] {
  const unique = new Map<string, PiPackageTarget>()
  for (const target of targets) {
    const source = target?.source?.trim()
    if (!source) continue
    const normalized = { ...target, source }
    unique.set(`${normalized.scope}:${normalized.projectRoot ?? ''}:${source}`, normalized)
  }
  return [...unique.values()]
}

function packageTarget(pkg: PiPackageInfo): PiPackageTarget {
  return { source: pkg.source, scope: pkg.scope, projectRoot: pkg.projectRoot }
}

function failedPackageAction(
  target: PiPackageTarget,
  action: PiPackageActionResult['action'],
  error: unknown
): PiPackageActionResult {
  return {
    source: target.source,
    scope: target.scope,
    action,
    ok: false,
    skipped: false,
    message: error instanceof Error ? error.message : String(error),
    stdout: '',
    stderr: '',
    errorCode: 'PROCESS_FAILED',
    logs: [
      { phase: action, ok: false, message: error instanceof Error ? error.message : String(error) }
    ]
  }
}

export { packageNameFromSource, resolveInstalledPackagePath } from '../packages/package-manager'

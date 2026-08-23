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
  PiPackageInfo,
  PiPackageResources,
  SkillInfo,
  SkillMarketCollection
} from '@shared/ipc/api-types'
import { piEnvironment } from '../pi/environment'
import { piProcess } from '../process/pi-process'
import { atomicWriteText, fileMtime, readTextFile } from './storage'
import { log } from './logger'
import type { AppSettings } from '@shared/ipc/api-types'
import type { JsonStore } from './storage'
import { ValidationError, FileSystemError, SkillConflictError } from './errors'
import { capabilityBackupDir } from './app-paths'

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
const PACKAGE_SOURCE_PATTERN =
  /^(?:npm:[@a-zA-Z0-9._/-]+(?:@[a-zA-Z0-9._-]+)?|git:[^\s]+|https?:\/\/[^\s]+|\.?\.?[\\/][^\0]+)$/
const EMPTY_RESOURCES = (): PiPackageResources => ({
  skills: [],
  prompts: [],
  extensions: [],
  themes: []
})

interface PackageManifest {
  name?: string
  version?: string
  description?: string
  pi?: Partial<Record<keyof PiPackageResources, unknown>>
}

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
  constructor(private readonly settingsStore: JsonStore<AppSettings>) {}

  async list(): Promise<SkillInfo[]> {
    const settings = this.settingsStore.peek()
    const env = await piEnvironment.detect({
      cliPath: settings.manualCliPath,
      configDir: settings.manualConfigDir
    })
    const out: SkillInfo[] = []
    for (const dir of env.skillsDirs) {
      const skills = await this.scanDir(dir, env.skillsDirs)
      out.push(...skills)
    }
    const packages = await this.listPackagesFromConfig(env.configDir)
    for (const pkg of packages) {
      if (!pkg.path || !pkg.available) continue
      out.push(...(await this.scanPackageSkills(pkg)))
    }
    return out.sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path))
  }

  /** Installed Pi packages, including their package-provided resources. */
  async listPackages(): Promise<PiPackageInfo[]> {
    const settings = this.settingsStore.peek()
    const env = await piEnvironment.detect({
      cliPath: settings.manualCliPath,
      configDir: settings.manualConfigDir
    })
    return this.listPackagesFromConfig(env.configDir)
  }

  /** Curated, product-owned package catalog. Reference documents are never exposed at runtime. */
  async listMarket(): Promise<SkillMarketCollection[]> {
    const installed = await this.listPackages()
    const installedBySource = new Map(installed.map((pkg) => [pkg.source, pkg]))
    const installedByName = new Map(installed.map((pkg) => [pkg.name, pkg]))
    return SKILL_MARKET_CATALOG.map((collection) => ({
      id: collection.id,
      kind: collection.kind,
      packages: collection.sources.map((source) => {
        const name = packageNameFromSource(source)
        const match = installedBySource.get(source) ?? installedByName.get(name)
        return {
          source,
          name,
          description: match?.description || MARKET_PACKAGE_DESCRIPTIONS[source] || '',
          installed: Boolean(match),
          installedVersion: match?.version ?? null
        }
      })
    }))
  }

  /** Install one or more marketplace sources, continuing after individual failures. */
  async installPackages(sources: string[]): Promise<PiPackageActionResult[]> {
    const unique = [...new Set(sources.map((source) => source.trim()).filter(Boolean))]
    if (unique.length === 0 || unique.length > 50) {
      throw new ValidationError('Choose between 1 and 50 packages to install.')
    }
    unique.forEach(assertPackageSource)

    const installed = new Set((await this.listPackages()).map((pkg) => pkg.source))
    const results: PiPackageActionResult[] = []
    for (const source of unique) {
      if (installed.has(source)) {
        results.push({
          source,
          ok: true,
          skipped: true,
          message: 'Already installed',
          stdout: '',
          stderr: ''
        })
        continue
      }
      try {
        const result = await piProcess.exec({
          args: ['install', source, '--no-approve'],
          timeoutMs: 5 * 60_000
        })
        const ok = result.exitCode === 0
        results.push({
          source,
          ok,
          skipped: false,
          message: ok ? 'Installed' : `Install failed (exit ${result.exitCode})`,
          stdout: result.stdout,
          stderr: result.stderr
        })
        if (ok) installed.add(source)
      } catch (err) {
        results.push({
          source,
          ok: false,
          skipped: false,
          message: (err as Error).message,
          stdout: '',
          stderr: ''
        })
      }
    }
    log.skills.info(
      `package install finished: ${results.filter((result) => result.ok).length}/${results.length}`
    )
    return results
  }

  /** Remove a configured Pi package through the native CLI. */
  async removePackage(source: string): Promise<PiPackageActionResult> {
    const normalized = source.trim()
    assertPackageSource(normalized)
    const installed = await this.listPackages()
    if (!installed.some((pkg) => pkg.source === normalized)) {
      throw new ValidationError(`Package is not installed: ${normalized}`)
    }
    return this.executePackageRemoval(normalized)
  }

  /** Remove multiple configured Pi packages, continuing after individual failures. */
  async removePackages(sources: string[]): Promise<PiPackageActionResult[]> {
    const unique = [...new Set(sources.map((source) => source.trim()).filter(Boolean))]
    if (unique.length === 0 || unique.length > 50) {
      throw new ValidationError('Choose between 1 and 50 packages to remove.')
    }
    unique.forEach(assertPackageSource)

    const installed = new Set((await this.listPackages()).map((pkg) => pkg.source))
    const results: PiPackageActionResult[] = []
    for (const source of unique) {
      if (!installed.has(source)) {
        results.push({
          source,
          ok: true,
          skipped: true,
          message: 'Already removed',
          stdout: '',
          stderr: ''
        })
        continue
      }
      try {
        const result = await this.executePackageRemoval(source)
        results.push(result)
        if (result.ok) installed.delete(source)
      } catch (err) {
        results.push({
          source,
          ok: false,
          skipped: false,
          message: (err as Error).message,
          stdout: '',
          stderr: ''
        })
      }
    }
    log.skills.info(
      `package removal finished: ${results.filter((result) => result.ok).length}/${results.length}`
    )
    return results
  }

  private async executePackageRemoval(source: string): Promise<PiPackageActionResult> {
    const result = await piProcess.exec({
      args: ['remove', source, '--no-approve'],
      timeoutMs: 5 * 60_000
    })
    const ok = result.exitCode === 0
    return {
      source,
      ok,
      skipped: false,
      message: ok ? 'Removed' : `Remove failed (exit ${result.exitCode})`,
      stdout: result.stdout,
      stderr: result.stderr
    }
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

  private async listPackagesFromConfig(configDir: string | null): Promise<PiPackageInfo[]> {
    if (!configDir) return []
    const settingsText = await readTextFile(path.join(configDir, 'settings.json'))
    if (!settingsText) return []

    let rawPackages: unknown[] = []
    try {
      const settings = JSON.parse(settingsText) as { packages?: unknown[] | null }
      rawPackages = Array.isArray(settings.packages) ? settings.packages : []
    } catch (err) {
      log.skills.warn('could not parse settings.json packages:', err)
      return []
    }

    const sources = rawPackages
      .map((entry) => {
        if (typeof entry === 'string') return entry
        if (entry && typeof entry === 'object' && 'source' in entry) {
          const source = (entry as { source?: unknown }).source
          return typeof source === 'string' ? source : null
        }
        return null
      })
      .filter((source): source is string => Boolean(source))

    const packages: PiPackageInfo[] = []
    for (const source of [...new Set(sources)]) {
      const fallbackName = packageNameFromSource(source)
      const packagePath = resolveInstalledPackagePath(configDir, source)
      const manifest = packagePath
        ? await readPackageManifest(path.join(packagePath, 'package.json'))
        : null
      const resources =
        packagePath && manifest
          ? await this.readPackageResources(packagePath, manifest)
          : EMPTY_RESOURCES()
      packages.push({
        source,
        name: manifest?.name || fallbackName,
        version: manifest?.version ?? null,
        description: manifest?.description ?? '',
        path: packagePath,
        installed: true,
        available: Boolean(packagePath && manifest),
        resources
      })
    }
    return packages.sort((a, b) => a.name.localeCompare(b.name))
  }

  private async readPackageResources(
    packageRoot: string,
    manifest: PackageManifest
  ): Promise<PiPackageResources> {
    const resources = EMPTY_RESOURCES()
    for (const kind of Object.keys(resources) as (keyof PiPackageResources)[]) {
      const entries = stringArray(manifest.pi?.[kind])
      if (kind === 'skills') {
        const dirs = await discoverSkillDirs(packageRoot, entries)
        resources.skills = dirs.map((dir) => path.basename(dir)).sort()
        continue
      }
      const names: string[] = []
      for (const entry of entries) {
        const resourcePath = safePackageResourcePath(packageRoot, entry)
        if (!resourcePath) continue
        names.push(...(await discoverResourceNames(resourcePath, kind)))
      }
      resources[kind] = [...new Set(names)].sort()
    }
    return resources
  }

  private async scanPackageSkills(pkg: PiPackageInfo): Promise<SkillInfo[]> {
    if (!pkg.path) return []
    const manifest = await readPackageManifest(path.join(pkg.path, 'package.json'))
    const skillEntries = stringArray(manifest?.pi?.skills)
    const dirs = await discoverSkillDirs(pkg.path, skillEntries)
    const skills: SkillInfo[] = []
    for (const skillPath of dirs) {
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
        packageSource: pkg.source
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
    return env.skillsDirs.map((d) => path.resolve(d))
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
    const packages = await this.listPackages()
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

  private async scanDir(dir: string, allowedRoots: string[]): Promise<SkillInfo[]> {
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
          origin: 'local'
        })
      }
      return skills
    } catch (err) {
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

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (entry): entry is string => typeof entry === 'string' && Boolean(entry.trim())
  )
}

function assertPackageSource(source: string): void {
  if (!PACKAGE_SOURCE_PATTERN.test(source) || source.includes('$') || source.includes('<')) {
    throw new ValidationError(`Invalid package source: ${source}`)
  }
}

export function packageNameFromSource(source: string): string {
  if (source.startsWith('npm:')) {
    const spec = source.slice(4)
    if (spec.startsWith('@')) {
      const slash = spec.indexOf('/')
      const versionAt = slash >= 0 ? spec.indexOf('@', slash) : -1
      return versionAt >= 0 ? spec.slice(0, versionAt) : spec
    }
    const versionAt = spec.lastIndexOf('@')
    return versionAt > 0 ? spec.slice(0, versionAt) : spec
  }
  const clean = source.replace(/[\\/]+$/, '').replace(/\.git$/i, '')
  return clean.split(/[\\/]/).at(-1) || source
}

export function resolveInstalledPackagePath(configDir: string, source: string): string | null {
  if (source.startsWith('npm:')) {
    return path.join(configDir, 'npm', 'node_modules', packageNameFromSource(source))
  }
  if (path.isAbsolute(source)) return path.resolve(source)
  if (source.startsWith('./') || source.startsWith('../')) {
    return path.resolve(configDir, source)
  }
  return null
}

async function readPackageManifest(manifestPath: string): Promise<PackageManifest | null> {
  const text = await readTextFile(manifestPath)
  if (!text) return null
  try {
    return JSON.parse(text) as PackageManifest
  } catch {
    return null
  }
}

function safePackageResourcePath(packageRoot: string, entry: string): string | null {
  const root = path.resolve(packageRoot)
  const target = path.resolve(root, entry)
  return target === root || target.startsWith(root + path.sep) ? target : null
}

async function discoverSkillDirs(packageRoot: string, entries: string[]): Promise<string[]> {
  const found = new Set<string>()
  for (const entry of entries) {
    const target = safePackageResourcePath(packageRoot, entry)
    if (!target) continue
    await walk(target, 0, async (itemPath, isDirectory) => {
      if (!isDirectory && path.basename(itemPath).toLowerCase() === 'skill.md') {
        found.add(path.dirname(itemPath))
      }
    })
  }
  return [...found].sort()
}

async function discoverResourceNames(
  resourcePath: string,
  kind: Exclude<keyof PiPackageResources, 'skills'>
): Promise<string[]> {
  const found = new Set<string>()
  const extensions: Record<typeof kind, Set<string>> = {
    prompts: new Set(['.md']),
    extensions: new Set(['.ts', '.js', '.mjs', '.cjs']),
    themes: new Set(['.json'])
  }
  await walk(resourcePath, 0, async (itemPath, isDirectory) => {
    if (isDirectory || !extensions[kind].has(path.extname(itemPath).toLowerCase())) return
    found.add(path.basename(itemPath, path.extname(itemPath)))
  })
  return [...found]
}

async function walk(
  target: string,
  depth: number,
  visit: (itemPath: string, isDirectory: boolean) => Promise<void>
): Promise<void> {
  if (depth > 5) return
  let stat
  try {
    stat = await fs.lstat(target)
  } catch {
    return
  }
  if (stat.isSymbolicLink()) return
  if (!stat.isDirectory()) {
    await visit(target, false)
    return
  }
  await visit(target, true)
  let entries
  try {
    entries = await fs.readdir(target, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    await walk(path.join(target, entry.name), depth + 1, visit)
  }
}

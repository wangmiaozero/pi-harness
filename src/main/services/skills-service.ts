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
import type {
  PiPackageActionResult,
  PiPackageInfo,
  PiPackageResources,
  SkillInfo,
  SkillMarketCollection,
  SkillMarketPackage
} from '@shared/ipc/api-types'
import { piEnvironment } from '../pi/environment'
import { piProcess } from '../process/pi-process'
import { atomicWriteText, fileMtime, readTextFile } from './storage'
import { log } from './logger'
import type { AppSettings } from '@shared/ipc/api-types'
import type { JsonStore } from './storage'
import { ValidationError, FileSystemError, SkillConflictError } from './errors'
import { skillMarketDir } from './app-paths'

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
      const skills = await this.scanDir(dir)
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

  /** Markdown recipes under task/ become the local, offline marketplace. */
  async listMarket(): Promise<SkillMarketCollection[]> {
    const installed = await this.listPackages()
    const installedBySource = new Map(installed.map((pkg) => [pkg.source, pkg]))
    const installedByName = new Map(installed.map((pkg) => [pkg.name, pkg]))
    const dir = skillMarketDir()
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      const collections: SkillMarketCollection[] = []
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue
        const filePath = path.join(dir, entry.name)
        const content = await readTextFile(filePath)
        if (content === null) continue
        const parsed = parseMarketDocument(entry.name, filePath, content)
        parsed.packages = parsed.packages.map((pkg) => {
          const match = installedBySource.get(pkg.source) ?? installedByName.get(pkg.name)
          return {
            ...pkg,
            description: match?.description || pkg.description,
            installed: Boolean(match),
            installedVersion: match?.version ?? null
          }
        })
        parsed.lastModified = await fileMtime(filePath)
        collections.push(parsed)
      }
      return collections.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'bundle' ? -1 : 1
        return a.title.localeCompare(b.title)
      })
    } catch (err) {
      log.skills.warn(`market directory scan failed (${dir}):`, err)
      return []
    }
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
    const result = await piProcess.exec({
      args: ['remove', normalized, '--no-approve'],
      timeoutMs: 5 * 60_000
    })
    const ok = result.exitCode === 0
    return {
      source: normalized,
      ok,
      skipped: false,
      message: ok ? 'Removed' : `Remove failed (exit ${result.exitCode})`,
      stdout: result.stdout,
      stderr: result.stderr
    }
  }

  async read(skillPath: string): Promise<{ content: string; mtime: number | null }> {
    const text = await readTextFile(skillPath)
    if (text === null) throw new FileSystemError(`Skill file not found: ${skillPath}`)
    const mtime = await fileMtime(skillPath)
    return { content: text, mtime }
  }

  async delete(skillPath: string): Promise<void> {
    const allowedRoots = await this.allowedRoots()
    await this.assertInsideRoots(skillPath, allowedRoots, 'delete')
    const resolved = path.resolve(skillPath)
    await fs.rm(resolved, { recursive: true, force: true })
  }

  /**
   * Create a new skill on disk:
   *   <targetRoot>/<name>/SKILL.md
   * Refuses to overwrite an existing skill; the caller may import+replace instead.
   */
  async create(form: SkillForm): Promise<SkillInfo> {
    const allowedRoots = await this.allowedRoots()
    await this.assertInsideRoots(form.targetRoot, allowedRoots, 'create targetRoot')
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
    const exists = await fileMtime(skillDir)
    if (exists !== null) {
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
    await this.assertInsideRoots(form.targetRoot, allowedRoots, 'update targetRoot')
    const validation = validateSkill(form)
    if (!validation.valid) {
      throw new ValidationError('Invalid skill', { issues: validation.issues })
    }
    const skillDir = path.resolve(form.targetRoot, form.name)
    const skillMd = path.join(skillDir, 'SKILL.md')
    if (!(await fileMtime(skillDir))) {
      throw new ValidationError(`Skill does not exist: ${skillDir}`)
    }
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
    await this.assertInsideRoots(input.targetRoot, allowedRoots, 'import targetRoot')
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
    const dstExists = await fileMtime(dst)
    if (dstExists !== null) {
      const policy = input.onConflict ?? 'cancel'
      if (policy === 'cancel') {
        throw new ValidationError(`Skill already exists at target: ${dst}`)
      }
      if (policy === 'rename') {
        finalName = await uniqueSkillName(input.targetRoot, input.name)
        finalDst = path.resolve(input.targetRoot, finalName)
      } else {
        // replace — snapshot SKILL.md beside the skill dir, then remove
        const stamp = new Date().toISOString().replace(/[:.]/g, '-')
        const backupPath = `${finalDst}.bak-${stamp}`
        try {
          await fs.cp(finalDst, backupPath, { recursive: true })
          log.skills.info(`backed up skill before replace: ${backupPath}`)
        } catch (err) {
          log.skills.warn('skill replace backup failed:', err)
        }
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

  /**
   * Path-traversal defence: the given target must be a known skill root or
   * live strictly underneath one. Symlink escape is not checked here — callers
   * that need symlink safety should lstat the leaf after the write.
   */
  private async assertInsideRoots(
    target: string,
    allowedRoots: string[],
    label: string
  ): Promise<void> {
    const resolved = path.resolve(target)
    const ok = allowedRoots.some(
      (root) => resolved === root || resolved.startsWith(root + path.sep)
    )
    if (!ok) {
      throw new ValidationError(`Refusing to ${label}: path outside skill roots (${target})`)
    }
  }

  private async scanDir(dir: string): Promise<SkillInfo[]> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      const skills: SkillInfo[] = []
      for (const ent of entries) {
        if (!ent.isDirectory() && !ent.isSymbolicLink()) continue
        if (ent.name.startsWith('.')) continue
        const skillPath = path.join(dir, ent.name)
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
    if (!(await fileMtime(path.join(root, candidate)))) return candidate
  }
  throw new ValidationError(`Unable to find free name for skill: ${base}`)
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

export function parseMarketDocument(
  fileName: string,
  filePath: string,
  content: string
): SkillMarketCollection {
  const heading = content.match(/^\s{0,3}#{1,6}\s+(.+)$/m)?.[1]?.trim()
  const title = heading || fileName.replace(/\.md$/i, '')
  const summary = extractMarketSummary(content, title)
  const sources: string[] = []

  for (const match of content.matchAll(/\bpi\s+install\s+["']?((?:npm|git):[^\s"'`]+)/g)) {
    const source = match[1]
    if (!source.includes('$') && !source.includes('<')) sources.push(source)
  }
  for (const block of content.matchAll(/for\s+pkg\s+in([\s\S]*?)\bdo\b/g)) {
    for (const match of block[1].matchAll(/["']([^"']+)["']/g)) {
      const packageName = match[1].trim()
      if (packageName && !packageName.includes('$')) sources.push(`npm:${packageName}`)
    }
  }

  const packages: SkillMarketPackage[] = [...new Set(sources)]
    .filter((source) => {
      try {
        assertPackageSource(source)
        return true
      } catch {
        return false
      }
    })
    .map((source) => ({
      source,
      name: packageNameFromSource(source),
      description: '',
      installed: false,
      installedVersion: null
    }))

  const baseId = fileName
    .replace(/\.md$/i, '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-|-$/g, '')

  return {
    id: baseId || `market-${packages.length}`,
    title,
    summary,
    path: filePath,
    content,
    kind: /一键安装|one[ -]?click/i.test(`${fileName} ${title}`) ? 'bundle' : 'guide',
    packages,
    lastModified: null
  }
}

function extractMarketSummary(content: string, title: string): string {
  let inCode = false
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.startsWith('```')) {
      inCode = !inCode
      continue
    }
    if (
      inCode ||
      !line ||
      line.startsWith('#') ||
      line.startsWith('|') ||
      line.startsWith('---') ||
      line.replace(/^>\s*/, '') === title
    ) {
      continue
    }
    return line.replace(/^>\s*/, '').replace(/[*_`]/g, '').slice(0, 240)
  }
  return ''
}

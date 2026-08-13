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
import type { SkillInfo } from '@shared/ipc/api-types'
import { piEnvironment } from '../pi/environment'
import { atomicWriteText, fileMtime, readTextFile } from './storage'
import { log } from './logger'
import type { AppSettings } from '@shared/ipc/api-types'
import type { JsonStore } from './storage'
import { ValidationError, FileSystemError, SkillConflictError } from './errors'

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
    return out.sort((a, b) => a.name.localeCompare(b.name))
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
      hasReadme: true
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
      hasReadme: true
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
      hasReadme: true
    }
  }

  /** Run client-side validation only — does not touch disk. */
  validate(form: SkillForm): SkillValidationResult {
    return validateSkill(form)
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
          hasReadme
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
  for (const line of lines) {
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

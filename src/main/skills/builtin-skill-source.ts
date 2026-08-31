/** Bundled Skill manifest validation, scanning and deterministic hashing. */

import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import path from 'node:path'
import type { BuiltinSkillCategory } from '@shared/ipc/api-types'
import { parseSkillDirectory } from '../capabilities/skill-parser'
import { SkillMutationError } from '../services/errors'
import builtinSources from '@shared/skills/builtin-sources.json'

export const BUILTIN_SKILL_CATEGORIES = ['engineering', 'productivity', 'misc'] as const

export interface BuiltinSkillSourceDefinition {
  id: string
  directory: string
}

export const BUILTIN_SKILL_SOURCES: readonly BuiltinSkillSourceDefinition[] = builtinSources

export interface BundledManifestSkill {
  id: string
  name: string
  description: string
  category: BuiltinSkillCategory
  sourcePath: string
  hash: string
  resources: string[]
}

export interface BundledManifest {
  schemaVersion: 1
  id: string
  name: string
  displayName: string
  author: string
  repository: string
  license: string
  commit: string
  syncedAt: string
  skills: BundledManifestSkill[]
}

export interface ScannedBuiltinSkill {
  id: string
  name: string
  description: string
  category: BuiltinSkillCategory
  sourcePath: string
  bundledPath: string
  bundledHash: string
  bundledHealthy: boolean
  resources: string[]
}

export interface ScannedBuiltinSource {
  root: string
  manifest: BundledManifest
  skills: ScannedBuiltinSkill[]
}

export async function scanBuiltinSkillSource(
  sourceRoot: string,
  expectedId?: string
): Promise<ScannedBuiltinSource> {
  const root = path.resolve(sourceRoot)
  const manifestText = await fs.readFile(path.join(root, 'manifest.json'), 'utf8').catch(() => null)
  if (!manifestText) {
    throw new SkillMutationError('SKILL_INVALID', 'Built-in collection manifest is missing')
  }
  let manifest: BundledManifest
  try {
    manifest = JSON.parse(manifestText) as BundledManifest
  } catch {
    throw new SkillMutationError('SKILL_INVALID', 'Built-in collection manifest is invalid')
  }
  validateManifest(manifest, expectedId)
  const expectedByPath = new Map(manifest.skills.map((skill) => [toSlash(skill.sourcePath), skill]))
  const scanned: ScannedBuiltinSkill[] = []
  for (const category of BUILTIN_SKILL_CATEGORIES) {
    const categoryRoot = path.join(root, 'skills', category)
    for (const entry of await readdirSafe(categoryRoot)) {
      if (
        !entry.isDirectory() ||
        entry.isSymbolicLink() ||
        !isSafeBuiltinSkillSegment(entry.name)
      ) {
        continue
      }
      const bundledPath = path.join(categoryRoot, entry.name)
      const parsed = await parseSkillDirectory(bundledPath)
      if (!parsed) continue
      const sourcePath = toSlash(path.relative(root, bundledPath))
      const expected = expectedByPath.get(sourcePath)
      const hashed = await hashSkillDirectory(bundledPath)
      scanned.push({
        id: entry.name,
        name: parsed.name || entry.name,
        description: parsed.description,
        category,
        sourcePath,
        bundledPath,
        bundledHash: hashed.hash,
        bundledHealthy: Boolean(
          expected &&
          expected.id === entry.name &&
          expected.category === category &&
          expected.hash === hashed.hash &&
          arraysEqual(expected.resources, hashed.resources)
        ),
        resources: hashed.resources
      })
    }
  }
  const scannedPaths = new Set(scanned.map((skill) => skill.sourcePath))
  for (const expected of manifest.skills) {
    const sourcePath = toSlash(expected.sourcePath)
    if (scannedPaths.has(sourcePath)) continue
    scanned.push({
      id: expected.id,
      name: expected.name,
      description: expected.description,
      category: expected.category,
      sourcePath,
      bundledPath: path.join(root, ...sourcePath.split('/')),
      bundledHash: expected.hash,
      bundledHealthy: false,
      resources: expected.resources
    })
  }
  return {
    root,
    manifest,
    skills: scanned.sort(
      (left, right) =>
        BUILTIN_SKILL_CATEGORIES.indexOf(left.category) -
          BUILTIN_SKILL_CATEGORIES.indexOf(right.category) || left.name.localeCompare(right.name)
    )
  }
}

export async function hashSkillDirectory(
  skillRoot: string
): Promise<{ hash: string; resources: string[] }> {
  const root = path.resolve(skillRoot)
  const hash = createHash('sha256')
  const resources: string[] = []
  async function visit(current: string): Promise<void> {
    for (const entry of await readdirSafe(current)) {
      const absolute = path.join(current, entry.name)
      const relative = toSlash(path.relative(root, absolute))
      if (!relative || relative.startsWith('../')) {
        throw new SkillMutationError('SKILL_PATH_INVALID', 'Skill resource escapes its source root')
      }
      if (entry.isSymbolicLink()) {
        throw new SkillMutationError('SKILL_PATH_INVALID', 'Bundled Skills cannot contain symlinks')
      }
      if (entry.isDirectory()) {
        await visit(absolute)
        continue
      }
      if (!entry.isFile()) continue
      const data = await fs.readFile(absolute)
      resources.push(relative)
      hash.update(relative)
      hash.update('\0')
      hash.update(normalizeTextLineEndings(data))
      hash.update('\0')
    }
  }
  await visit(root)
  return { hash: hash.digest('hex'), resources }
}

export function isSafeBuiltinSkillSegment(value: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{0,127}$/.test(value)
}

function validateManifest(manifest: BundledManifest, expectedId?: string): void {
  if (
    !manifest ||
    manifest.schemaVersion !== 1 ||
    !manifest.id ||
    (expectedId && manifest.id !== expectedId) ||
    !manifest.name ||
    !manifest.displayName ||
    !manifest.author ||
    !manifest.repository ||
    manifest.license !== 'MIT' ||
    !Array.isArray(manifest.skills)
  ) {
    throw new SkillMutationError('SKILL_INVALID', 'Built-in collection manifest is invalid')
  }
  const ids = new Set<string>()
  for (const skill of manifest.skills) {
    if (
      !isSafeBuiltinSkillSegment(skill.id) ||
      ids.has(skill.id) ||
      !BUILTIN_SKILL_CATEGORIES.includes(skill.category) ||
      toSlash(skill.sourcePath) !== `skills/${skill.category}/${skill.id}` ||
      !/^[a-f0-9]{64}$/.test(skill.hash) ||
      !Array.isArray(skill.resources) ||
      skill.resources.some(
        (resource) =>
          !resource ||
          path.posix.isAbsolute(toSlash(resource)) ||
          toSlash(resource).split('/').includes('..')
      )
    ) {
      throw new SkillMutationError('SKILL_INVALID', 'Built-in Skill manifest entry is invalid')
    }
    ids.add(skill.id)
  }
}

function toSlash(value: string): string {
  return value.replace(/\\/g, '/')
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function normalizeTextLineEndings(data: Buffer): Buffer {
  const text = data.toString('utf8')
  if (!text.includes('\r\n') || !Buffer.from(text, 'utf8').equals(data)) return data
  return Buffer.from(text.replace(/\r\n/g, '\n'), 'utf8')
}

async function readdirSafe(directory: string): Promise<Dirent<string>[]> {
  try {
    return (await fs.readdir(directory, { withFileTypes: true })).sort((left, right) =>
      left.name.localeCompare(right.name)
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

/** Read-only package manifest/resource/health inspection. */

import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  PiPackageHealth,
  PiPackageProblem,
  PiPackageResource,
  PiPackageResources,
  PiPackageSourceType
} from '@shared/ipc/api-types'
import { readTextFile } from '../services/storage'

export interface PackageManifest {
  name?: string
  version?: string
  description?: string
  dependencies?: Record<string, unknown>
  pi?: Partial<Record<'skills' | 'prompts' | 'extensions' | 'themes', unknown>>
}

type ResourceKind = 'skills' | 'prompts' | 'extensions' | 'themes'
export type ResourceFilter = Partial<Record<ResourceKind, string[]>>

export interface PackageInspection {
  manifest: PackageManifest | null
  manifestState: 'valid' | 'missing' | 'invalid'
  resources: PiPackageResources
  resourceItems: PiPackageResource[]
  problems: PiPackageProblem[]
}

export const emptyPackageResources = (): PiPackageResources => ({
  skills: [],
  prompts: [],
  extensions: [],
  themes: [],
  tools: []
})

export async function inspectPackageContents(
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
        ...emptyPackageResources(),
        extensions: isExtension ? [path.basename(packagePath, extension)] : [],
        tools: toolItems.map((item) => item.name)
      },
      resourceItems: [...extensionItems, ...toolItems],
      problems: isExtension
        ? []
        : [
            packageProblem(
              'MANIFEST_MISSING',
              'Local package file is not a Pi extension',
              packagePath
            )
          ]
    }
  }
  const manifestResult = await readPackageManifest(path.join(packagePath, 'package.json'))
  const manifest = manifestResult.value
  const resources = emptyPackageResources()
  const resourceItems: PiPackageResource[] = []
  const problems: PiPackageProblem[] = []
  if (sourceType === 'npm' && manifestResult.state === 'missing') {
    problems.push(packageProblem('MANIFEST_MISSING', 'npm package.json is missing', packagePath))
  } else if (manifestResult.state === 'invalid') {
    problems.push(packageProblem('MANIFEST_INVALID', 'package.json is invalid', packagePath))
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
          packageProblem(
            'DEPENDENCY_MISSING',
            `Runtime dependency is missing: ${dependency}`,
            local
          )
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
  kind: ResourceKind,
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

export function resourceFilterFromRegistry(raw: unknown): ResourceFilter | undefined {
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

export async function readPackageManifest(
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

export async function looksLikePiPackage(
  packagePath: string,
  manifest: PackageManifest | null
): Promise<boolean> {
  if (manifest?.pi && typeof manifest.pi === 'object') return true
  for (const kind of ['skills', 'prompts', 'extensions', 'themes'] as const) {
    if ((await discoverResources(packagePath, kind, [kind])).length > 0) return true
  }
  return false
}

export async function topLevelNpmPackages(root: string): Promise<string[]> {
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
      if (scoped.isDirectory() && !scoped.name.startsWith('.')) {
        packages.push(path.join(target, scoped.name))
      }
    }
  }
  return packages
}

export async function discoverGitPackages(root: string): Promise<string[]> {
  const found: string[] = []
  async function scan(current: string, depth: number): Promise<void> {
    if (depth > 4) return
    if (await lstatOrNull(path.join(current, '.git'))) {
      found.push(current)
      return
    }
    for (const entry of await readdirSafe(current)) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        await scan(path.join(current, entry.name), depth + 1)
      }
    }
  }
  await scan(root, 0)
  return found
}

export async function readGitOrigin(packagePath: string): Promise<string | null> {
  const config = await readTextFile(path.join(packagePath, '.git', 'config'))
  if (!config) return null
  const remote = config.match(/\[remote "origin"\][\s\S]*?\n\s*url\s*=\s*([^\r\n]+)/)?.[1]?.trim()
  if (!remote) return null
  return remote.includes('://') ? remote : `git:${remote}`
}

export function resolvePackageHealth(
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

export function packageProblem(
  code: PiPackageProblem['code'],
  message: string,
  problemPath: string | null,
  recoverable = true
): PiPackageProblem {
  return { code, message, path: problemPath, recoverable }
}

export function dedupePackageProblems(problems: PiPackageProblem[]): PiPackageProblem[] {
  const seen = new Set<string>()
  return problems.filter((entry) => {
    const key = `${entry.code}:${entry.path ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
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
  } catch {
    return null
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim()))
    : []
}

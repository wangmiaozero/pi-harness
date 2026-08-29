/**
 * VS Code / Cursor `.code-workspace` parse + serialize.
 *
 * Unknown top-level keys and settings are preserved. Pi-Harness extras live
 * under settings.piHarness so the file stays openable in VS Code / Cursor.
 */

import path from 'node:path'
import type { WorkspaceFolderRole } from '../types/workspace'
import { isWindowsAbsolutePath, toSlashPath } from './paths'
import { projectIdentityKey } from './project-identity'
import { projectDisplayName } from './session-tree'

export const PI_HARNESS_SETTINGS_KEY = 'piHarness'

export interface CodeWorkspaceFolder {
  path: string
  name?: string
  [key: string]: unknown
}

export interface PiHarnessWorkspaceSettings {
  mainFolder?: string
  folderMeta?: Record<string, { role?: WorkspaceFolderRole; readonly?: boolean }>
}

export interface CodeWorkspaceDocument {
  folders: CodeWorkspaceFolder[]
  settings?: Record<string, unknown>
  [key: string]: unknown
}

const WORKSPACE_FOLDER_ROLES: readonly WorkspaceFolderRole[] = [
  'main',
  'reference',
  'dependency',
  'docs'
]

export function isWorkspaceFolderRole(value: unknown): value is WorkspaceFolderRole {
  return typeof value === 'string' && WORKSPACE_FOLDER_ROLES.includes(value as WorkspaceFolderRole)
}

export function parseCodeWorkspace(text: string): CodeWorkspaceDocument {
  const parsed = parseJsonc(text)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Workspace file must be a JSON object')
  }
  const record = parsed as Record<string, unknown>
  const foldersRaw = record.folders
  if (!Array.isArray(foldersRaw) || foldersRaw.length === 0) {
    throw new Error('Workspace file must contain a non-empty folders array')
  }
  const folders: CodeWorkspaceFolder[] = foldersRaw.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`Workspace folder ${index} is invalid`)
    }
    const folder = entry as Record<string, unknown>
    if (typeof folder.path !== 'string' || !folder.path.trim()) {
      throw new Error(`Workspace folder ${index} is missing path`)
    }
    return { ...folder, path: folder.path.trim() } as CodeWorkspaceFolder
  })
  const settings =
    record.settings && typeof record.settings === 'object' && !Array.isArray(record.settings)
      ? { ...(record.settings as Record<string, unknown>) }
      : undefined
  return { ...record, folders, ...(settings ? { settings } : {}) }
}

export function serializeCodeWorkspace(document: CodeWorkspaceDocument): string {
  const folders = document.folders.map((folder) => {
    const next: CodeWorkspaceFolder = { ...folder, path: folder.path }
    if (!next.name) delete next.name
    return next
  })
  const payload: CodeWorkspaceDocument = {
    ...document,
    folders,
    settings: document.settings ?? {}
  }
  return `${JSON.stringify(payload, null, 2)}\n`
}

export function resolveWorkspaceFolderPath(
  workspaceFile: string,
  folderPath: string,
  platform: NodeJS.Platform = process.platform
): string {
  const trimmed = folderPath.trim()
  const resolver = pathResolver(workspaceFile, trimmed, platform)
  if (resolver.isAbsolute(trimmed) || isWindowsAbsolutePath(trimmed)) {
    return normalizeResolved(resolver.normalize(trimmed), resolver)
  }
  return normalizeResolved(resolver.join(resolver.dirname(workspaceFile), trimmed), resolver)
}

export function toWorkspaceRelativePath(
  workspaceFile: string,
  resolvedPath: string,
  platform: NodeJS.Platform = process.platform
): string {
  const resolver = pathResolver(workspaceFile, resolvedPath, platform)
  const relative = resolver.relative(resolver.dirname(workspaceFile), resolvedPath)
  if (!relative || relative.startsWith('..') || resolver.isAbsolute(relative)) {
    return toSlashPath(resolvedPath)
  }
  return toSlashPath(relative) || '.'
}

export function readPiHarnessSettings(
  settings: Record<string, unknown> | undefined
): PiHarnessWorkspaceSettings {
  const raw = settings?.[PI_HARNESS_SETTINGS_KEY]
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const record = raw as Record<string, unknown>
  const folderMeta: PiHarnessWorkspaceSettings['folderMeta'] = {}
  if (record.folderMeta && typeof record.folderMeta === 'object' && !Array.isArray(record.folderMeta)) {
    for (const [key, value] of Object.entries(record.folderMeta as Record<string, unknown>)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const meta = value as Record<string, unknown>
      folderMeta[key] = {
        ...(isWorkspaceFolderRole(meta.role) ? { role: meta.role } : {}),
        ...(typeof meta.readonly === 'boolean' ? { readonly: meta.readonly } : {})
      }
    }
  }
  return {
    ...(typeof record.mainFolder === 'string' && record.mainFolder.trim()
      ? { mainFolder: record.mainFolder.trim() }
      : {}),
    ...(Object.keys(folderMeta).length ? { folderMeta } : {})
  }
}

export function writePiHarnessSettings(
  settings: Record<string, unknown> | undefined,
  piHarness: PiHarnessWorkspaceSettings
): Record<string, unknown> {
  const next = { ...(settings ?? {}) }
  const existingRaw = next[PI_HARNESS_SETTINGS_KEY]
  const existing =
    existingRaw && typeof existingRaw === 'object' && !Array.isArray(existingRaw)
      ? { ...(existingRaw as Record<string, unknown>) }
      : {}
  const payload: Record<string, unknown> = { ...existing }
  if (piHarness.mainFolder) payload.mainFolder = piHarness.mainFolder
  else delete payload.mainFolder
  if (piHarness.folderMeta && Object.keys(piHarness.folderMeta).length) {
    payload.folderMeta = piHarness.folderMeta
  } else {
    delete payload.folderMeta
  }
  if (Object.keys(payload).length) next[PI_HARNESS_SETTINGS_KEY] = payload
  else delete next[PI_HARNESS_SETTINGS_KEY]
  return next
}

export function folderRoleFromSettings(
  folder: { path: string; name?: string; resolvedPath: string },
  index: number,
  piHarness: PiHarnessWorkspaceSettings
): WorkspaceFolderRole {
  const meta = lookupFolderMeta(folder, piHarness)
  if (meta?.role) return meta.role
  if (matchesMainFolder(folder, piHarness.mainFolder)) return 'main'
  return index === 0 ? 'main' : 'reference'
}

export function folderReadonlyFromSettings(
  folder: { path: string; name?: string; resolvedPath: string },
  piHarness: PiHarnessWorkspaceSettings
): boolean {
  return lookupFolderMeta(folder, piHarness)?.readonly === true
}

export function workspaceDisplayName(workspaceFile: string | null, folders: { name: string }[]): string {
  if (workspaceFile) {
    const base = projectDisplayName(workspaceFile)
    return base.endsWith('.code-workspace') ? base.slice(0, -'.code-workspace'.length) || base : base
  }
  return folders[0]?.name || 'Workspace'
}

export function workspaceIdentity(
  workspaceFile: string | null,
  folderPaths: string[],
  platform?: NodeJS.Platform
): string {
  if (workspaceFile) return `file:${projectIdentityKey(workspaceFile, platform)}`
  return `folders:${folderPaths.map((item) => projectIdentityKey(item, platform)).join('|')}`
}

function lookupFolderMeta(
  folder: { path: string; name?: string; resolvedPath: string },
  piHarness: PiHarnessWorkspaceSettings
): { role?: WorkspaceFolderRole; readonly?: boolean } | undefined {
  const meta = piHarness.folderMeta
  if (!meta) return undefined
  return (
    meta[folder.path] ??
    meta[folder.resolvedPath] ??
    meta[toSlashPath(folder.resolvedPath)] ??
    (folder.name ? meta[folder.name] : undefined)
  )
}

function matchesMainFolder(
  folder: { path: string; name?: string; resolvedPath: string },
  mainFolder: string | undefined
): boolean {
  if (!mainFolder) return false
  return (
    folder.path === mainFolder ||
    folder.resolvedPath === mainFolder ||
    toSlashPath(folder.resolvedPath) === toSlashPath(mainFolder) ||
    folder.name === mainFolder ||
    projectDisplayName(folder.resolvedPath) === mainFolder
  )
}

function pathResolver(workspaceFile: string, folderPath: string, platform: NodeJS.Platform) {
  const useWin =
    platform === 'win32' || isWindowsAbsolutePath(workspaceFile) || isWindowsAbsolutePath(folderPath)
  return useWin ? path.win32 : path.posix
}

function normalizeResolved(value: string, resolver: typeof path.posix): string {
  const parsed = resolver.parse(value)
  let end = value.length
  const sep = resolver.sep
  while (end > parsed.root.length && value[end - 1] === sep) end--
  return value.slice(0, end)
}

function parseJsonc(text: string): unknown {
  const trimmed = text.replace(/^\uFEFF/, '')
  try {
    return JSON.parse(trimmed)
  } catch {
    return JSON.parse(stripJsonc(trimmed))
  }
}

function stripJsonc(text: string): string {
  let result = ''
  let inString = false
  let quote: '"' | "'" | null = null
  let escaped = false
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    const next = text[i + 1]
    if (inString) {
      result += ch
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === quote) {
        inString = false
        quote = null
      }
      i += 1
      continue
    }
    if (ch === '"' || ch === "'") {
      inString = true
      quote = ch
      result += ch
      i += 1
      continue
    }
    if (ch === '/' && next === '/') {
      i += 2
      while (i < text.length && text[i] !== '\n') i += 1
      continue
    }
    if (ch === '/' && next === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1
      i += 2
      continue
    }
    result += ch
    i += 1
  }
  return result.replace(/,\s*([}\]])/g, '$1')
}

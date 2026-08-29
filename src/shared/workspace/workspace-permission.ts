import type { WorkspaceFolder } from '../types/workspace'
import { isPathWithinProjectRoots } from './project-identity'

export function findContainingWorkspaceFolder<T extends { resolvedPath: string }>(
  target: string,
  folders: readonly T[]
): T | null {
  const matches = folders.filter(
    (folder) => folder.resolvedPath && isPathWithinProjectRoots(target, [folder.resolvedPath])
  )
  if (!matches.length) return null
  matches.sort((a, b) => b.resolvedPath.length - a.resolvedPath.length)
  return matches[0] ?? null
}

export function isWorkspacePathWritable(
  target: string,
  folders: readonly Pick<WorkspaceFolder, 'resolvedPath' | 'readonly' | 'exists'>[]
): boolean {
  const folder = findContainingWorkspaceFolder(target, folders)
  if (!folder || folder.exists === false) return false
  return folder.readonly !== true
}

export function writableWorkspaceRoots(
  folders: readonly Pick<WorkspaceFolder, 'resolvedPath' | 'readonly' | 'exists'>[]
): string[] {
  return folders
    .filter((folder) => folder.exists !== false && folder.readonly !== true && folder.resolvedPath)
    .map((folder) => folder.resolvedPath)
}

export function readableWorkspaceRoots(
  folders: readonly Pick<WorkspaceFolder, 'resolvedPath' | 'exists'>[]
): string[] {
  return folders
    .filter((folder) => folder.exists !== false && folder.resolvedPath)
    .map((folder) => folder.resolvedPath)
}

export function ensureSingleMainFolder<T extends { role: WorkspaceFolder['role'] }>(
  folders: T[],
  mainIndex = 0
): T[] {
  if (!folders.length) return folders
  const preferred = Math.min(Math.max(mainIndex, 0), folders.length - 1)
  return folders.map((folder, index) => ({
    ...folder,
    role: index === preferred ? 'main' : folder.role === 'main' ? 'reference' : folder.role
  }))
}

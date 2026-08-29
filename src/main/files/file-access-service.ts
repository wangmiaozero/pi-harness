/**
 * Allowed-roots gate for every file / git / upload path.
 * Session cwds, project roots, and explicitly chosen directories only.
 */

import { readdir, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { PathDeniedError } from '../services/errors'
import { isPathWithinRoots } from '@shared/workspace/path-security'
import { toSlashPath } from '@shared/workspace/paths'
import { isWorkspacePathWritable } from '@shared/workspace/workspace-permission'
import type { SessionInfo, WorkspaceFolder } from '@shared/types/workspace'
import type { JsonStore } from '../services/storage'

export interface AuthorizedRootsState {
  roots: string[]
}

export class FileAccessService {
  private additionalRoots = new Set<string>()
  private activeRoot: string | null = null
  private workspaceFolders: Array<Pick<WorkspaceFolder, 'resolvedPath' | 'readonly' | 'exists'>> = []
  private cache: { roots: Set<string>; realRoots: Set<string> | null; expiresAt: number } | null =
    null
  private listSessions: () => Promise<SessionInfo[]> = async () => []

  constructor(private readonly authorizedRootsStore?: JsonStore<AuthorizedRootsState>) {}

  attachSessionLister(listSessions: () => Promise<SessionInfo[]>): void {
    this.listSessions = listSessions
  }

  allowRoot(root: string): void {
    if (!root) return
    const normalized = toSlashPath(root)
    this.additionalRoots.add(normalized)
    if (this.cache) {
      this.cache.roots.add(normalized)
      this.cache.realRoots = null
    }
  }

  setWorkspaceFolders(
    folders: Array<Pick<WorkspaceFolder, 'resolvedPath' | 'readonly' | 'exists'>>
  ): void {
    this.workspaceFolders = folders.filter((folder) => folder.resolvedPath)
    for (const folder of this.workspaceFolders) {
      if (folder.exists !== false) this.allowRoot(folder.resolvedPath)
    }
    this.invalidate()
  }

  getWorkspaceFolders(): Array<Pick<WorkspaceFolder, 'resolvedPath' | 'readonly' | 'exists'>> {
    return this.workspaceFolders
  }

  /** Persist a root only after an explicit OS picker or native file-drop gesture. */
  async authorizeRoot(root: string): Promise<string> {
    const resolved = await this.assertDirectory(root)
    this.allowRoot(resolved)
    this.activeRoot = resolved
    if (this.authorizedRootsStore) {
      const current = await this.authorizedRootsStore.read()
      const roots = [...new Set([...current.roots, resolved])]
      await this.authorizedRootsStore.write({ roots })
    }
    return resolved
  }

  /** Restore is read-only with respect to grants: it cannot create a new permission. */
  async restoreRoot(root: string): Promise<string> {
    const resolved = await this.assertAllowed(root, { mustExist: true })
    this.activeRoot = await this.assertDirectory(resolved)
    return this.activeRoot
  }

  getActiveRoot(): string | null {
    return this.activeRoot
  }

  invalidate(): void {
    this.cache = null
  }

  async getAllowedRoots(): Promise<Set<string>> {
    const now = Date.now()
    if (this.cache && this.cache.expiresAt > now) return this.cache.roots

    const roots = new Set<string>()
    const sessions = await this.listSessions()
    for (const session of sessions) {
      if (session.cwd) roots.add(toSlashPath(session.cwd))
      if (session.projectRoot) roots.add(toSlashPath(session.projectRoot))
    }

    try {
      for (const name of await readdir(homedir())) {
        if (/^pi-cwd-\d{8}$/.test(name)) {
          roots.add(toSlashPath(path.join(homedir(), name)))
        }
      }
    } catch {
      /* home unreadable */
    }

    for (const root of this.additionalRoots) roots.add(root)
    if (this.authorizedRootsStore) {
      const persisted = await this.authorizedRootsStore.read()
      for (const root of persisted.roots) {
        if (typeof root === 'string' && root) roots.add(toSlashPath(root))
      }
    }
    this.cache = { roots, realRoots: null, expiresAt: now + 5_000 }
    return roots
  }

  async assertAllowed(target: string, options: { mustExist?: boolean } = {}): Promise<string> {
    const roots = await this.getAllowedRoots()
    const lexicallyAllowed = isPathWithinRoots(target, roots)
    let realRoots: Set<string> | null = null
    let realTarget: string | null = null
    if (!lexicallyAllowed) {
      realRoots = await this.getRealRoots(roots)
      if (options.mustExist) {
        try {
          realTarget = await realpath(target)
        } catch {
          throw new PathDeniedError('Path does not exist or cannot be resolved', { target })
        }
      }
      if (!isPathWithinRoots(realTarget ?? target, realRoots)) {
        throw new PathDeniedError('Path is outside the allowed workspace roots', { target })
      }
    }
    if (!options.mustExist) return target

    if (!realTarget) {
      try {
        realTarget = await realpath(target)
      } catch {
        throw new PathDeniedError('Path does not exist or cannot be resolved', { target })
      }
    }
    realRoots ??= await this.getRealRoots(roots)
    if (!isPathWithinRoots(realTarget, realRoots)) {
      throw new PathDeniedError('Resolved path escapes the allowed workspace roots', { target })
    }
    return realTarget
  }

  async assertWritable(target: string, options: { mustExist?: boolean } = {}): Promise<string> {
    const allowed = await this.assertAllowed(target, options)
    return this.assertWritableInFolders(target, this.workspaceFolders, allowed)
  }

  async assertWritableInFolders(
    target: string,
    folders: Array<Pick<WorkspaceFolder, 'resolvedPath' | 'readonly' | 'exists'>>,
    alreadyAllowed?: string
  ): Promise<string> {
    const allowed = alreadyAllowed ?? (await this.assertAllowed(target))
    if (!folders.length) return allowed
    if (
      !isWorkspacePathWritable(allowed, folders) &&
      !isWorkspacePathWritable(target, folders)
    ) {
      throw new PathDeniedError(
        'This path is outside the projects attached to the current session or is read-only.',
        { target }
      )
    }
    return allowed
  }

  private async getRealRoots(roots: Set<string>): Promise<Set<string>> {
    if (this.cache?.roots === roots && this.cache.realRoots) return this.cache.realRoots

    const resolved = await Promise.all(
      [...roots].map(async (root) => {
        try {
          return await realpath(root)
        } catch {
          return null
        }
      })
    )
    const realRoots = new Set(resolved.filter((root): root is string => root !== null))
    if (this.cache?.roots === roots) this.cache.realRoots = realRoots
    return realRoots
  }

  private async assertDirectory(target: string): Promise<string> {
    let resolved: string
    try {
      resolved = await realpath(target)
      if (!(await stat(resolved)).isDirectory()) throw new Error('not a directory')
    } catch {
      throw new PathDeniedError('Authorized root must be an existing directory', { target })
    }
    return resolved
  }
}

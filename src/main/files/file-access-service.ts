/**
 * Allowed-roots gate for every file / git / upload path.
 * Session cwds, project roots, and explicitly chosen directories only.
 */

import { readdir, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { PathDeniedError } from '../services/errors'
import { isPathWithinRoots } from '@shared/workspace/path-security'
import { toSlashPath } from '@shared/workspace/paths'
import type { SessionInfo } from '@shared/types/workspace'

export class FileAccessService {
  private additionalRoots = new Set<string>()
  private cache: { roots: Set<string>; realRoots: Set<string> | null; expiresAt: number } | null =
    null
  private listSessions: () => Promise<SessionInfo[]> = async () => []

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
    this.cache = { roots, realRoots: null, expiresAt: now + 5_000 }
    return roots
  }

  async assertAllowed(target: string, options: { mustExist?: boolean } = {}): Promise<string> {
    const roots = await this.getAllowedRoots()
    const lexicallyAllowed = isPathWithinRoots(target, roots)
    let realRoots: Set<string> | null = null
    if (!lexicallyAllowed) {
      realRoots = await this.getRealRoots(roots)
    }
    if (!lexicallyAllowed && !isPathWithinRoots(target, realRoots ?? [])) {
      throw new PathDeniedError('Path is outside the allowed workspace roots', { target })
    }
    if (!options.mustExist) return target

    let realTarget: string
    try {
      realTarget = await realpath(target)
    } catch {
      throw new PathDeniedError('Path does not exist or cannot be resolved', { target })
    }
    realRoots ??= await this.getRealRoots(roots)
    if (!isPathWithinRoots(realTarget, realRoots)) {
      throw new PathDeniedError('Resolved path escapes the allowed workspace roots', { target })
    }
    return realTarget
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
}

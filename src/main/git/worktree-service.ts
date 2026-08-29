import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { gitExec, isNotAGitRepository } from './git-exec'
import { GitError } from '../services/errors'
import type { FileAccessService } from '../files/file-access-service'
import type { ProjectInfo, WorktreeInfo } from '@shared/types/workspace'
import { samePath, toNativePath } from '@shared/workspace/paths'
import { realpath } from 'node:fs/promises'

const PROJECT_CACHE_TTL_MS = 60_000

export class WorktreeService {
  private projectCache = new Map<string, { info: ProjectInfo; expiresAt: number }>()

  constructor(private readonly access: FileAccessService) {}

  invalidate(): void {
    this.projectCache.clear()
  }

  async resolveProject(cwd: string): Promise<ProjectInfo> {
    const cached = this.projectCache.get(cwd)
    if (cached && cached.expiresAt > Date.now()) return cached.info

    let info: ProjectInfo
    try {
      if (!existsSync(cwd)) {
        info = inferRemovedWorktree(cwd) ?? {
          projectRoot: cwd,
          branch: null,
          isWorktree: false,
          isTopLevel: false
        }
        this.projectCache.set(cwd, { info, expiresAt: Date.now() + PROJECT_CACHE_TTL_MS })
        return info
      }
      const out = await gitExec(cwd, [
        'rev-parse',
        '--path-format=absolute',
        '--git-common-dir',
        '--git-dir',
        '--show-toplevel',
        '--abbrev-ref',
        'HEAD'
      ])
      const [commonDirRaw, gitDirRaw, toplevelRaw, ref] = out.split('\n').map((l) => l.trim())
      const [commonDir, gitDir, toplevel] = [commonDirRaw, gitDirRaw, toplevelRaw].map((p) =>
        toNativePath(p ?? '')
      )
      const realCwd = await realPathOrSelf(cwd)
      const isTopLevel = samePath(toplevel, realCwd)
      const isWorktreeTopLevel = !samePath(gitDir, commonDir) && isTopLevel
      const topLevelProjectRoot = isWorktreeTopLevel ? dirname(commonDir) : toplevel
      info = {
        projectRoot: isTopLevel ? await realPathOrSelf(topLevelProjectRoot) : realCwd,
        branch: ref && ref !== 'HEAD' ? ref : null,
        isWorktree: isWorktreeTopLevel,
        isTopLevel
      }
    } catch {
      info = { projectRoot: await realPathOrSelf(cwd), branch: null, isWorktree: false, isTopLevel: false }
    }

    this.projectCache.set(cwd, { info, expiresAt: Date.now() + PROJECT_CACHE_TTL_MS })
    return info
  }

  async list(cwd: string): Promise<WorktreeInfo[]> {
    await this.access.assertAllowed(cwd, { mustExist: true })
    let out: string
    try {
      out = await gitExec(cwd, ['worktree', 'list', '--porcelain'])
    } catch (error) {
      if (isNotAGitRepository(error)) return []
      throw error
    }
    const worktrees: WorktreeInfo[] = []
    let current: (Partial<WorktreeInfo> & { prunable?: boolean }) | null = null

    const flush = () => {
      if (current?.path) {
        if (!current.prunable && existsSync(current.path)) {
          worktrees.push({
            path: current.path,
            branch: current.branch ?? null,
            isMain: worktrees.length === 0
          })
        }
      }
      current = null
    }

    for (const line of out.split('\n')) {
      if (line.startsWith('worktree ')) {
        flush()
        current = { path: toNativePath(line.slice('worktree '.length).trim()) }
      } else if (line.startsWith('branch ') && current) {
        current.branch = line
          .slice('branch '.length)
          .trim()
          .replace(/^refs\/heads\//, '')
      } else if (line.startsWith('prunable') && current) {
        current.prunable = true
      } else if (line.trim() === '') {
        flush()
      }
    }
    flush()
    return worktrees
  }

  async create(cwd: string, branch: string): Promise<{ path: string; branch: string }> {
    await this.access.assertAllowed(cwd, { mustExist: true })
    const trimmed = branch.trim()
    if (!trimmed) throw new GitError('Branch name is required')
    const dirName = sanitizeBranchForDir(trimmed)
    if (!dirName) throw new GitError(`Invalid branch name: ${branch}`)

    const repoRoot = await getRepoRoot(cwd)
    const baseDir = `${resolve(repoRoot)}-worktrees`
    const worktreePath = join(baseDir, dirName)
    if (existsSync(worktreePath)) throw new GitError(`Directory already exists: ${worktreePath}`)
    await mkdir(baseDir, { recursive: true })

    let branchExists = false
    try {
      await gitExec(repoRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${trimmed}`])
      branchExists = true
    } catch {
      branchExists = false
    }

    if (branchExists) {
      await gitExec(repoRoot, ['worktree', 'add', '--', worktreePath, trimmed])
    } else {
      await gitExec(repoRoot, ['worktree', 'add', '-b', trimmed, '--', worktreePath])
    }

    this.access.allowRoot(worktreePath)
    this.invalidate()
    return { path: worktreePath, branch: trimmed }
  }

  async remove(cwd: string, worktreePath: string, force = false): Promise<void> {
    await this.access.assertAllowed(cwd, { mustExist: true })
    const worktrees = await this.list(cwd)
    const target = worktrees.find((worktree) => samePath(worktree.path, worktreePath))
    if (!target) throw new GitError(`Not a worktree of this repository: ${worktreePath}`)
    if (target.isMain) throw new GitError('Cannot remove the main worktree')
    await gitExec(cwd, ['worktree', 'remove', ...(force ? ['--force'] : []), target.path])
    this.invalidate()
  }
}

async function getRepoRoot(cwd: string): Promise<string> {
  const commonDir = await gitExec(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  return realPathOrSelf(dirname(toNativePath(commonDir.trim())))
}

function sanitizeBranchForDir(branch: string): string {
  return branch.replace(/[/\\:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '')
}

function inferRemovedWorktree(cwd: string): ProjectInfo | null {
  const parent = dirname(cwd)
  if (!parent.endsWith('-worktrees')) return null
  const repoRoot = parent.slice(0, '-worktrees'.length * -1)
  if (!repoRoot || !existsSync(join(repoRoot, '.git'))) return null
  return {
    projectRoot: repoRoot,
    branch: basename(cwd),
    isWorktree: true,
    isTopLevel: true
  }
}

async function realPathOrSelf(filePath: string): Promise<string> {
  try {
    return await realpath(filePath)
  } catch {
    return filePath
  }
}

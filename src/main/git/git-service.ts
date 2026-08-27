import path from 'node:path'
import { gitExec, isNotAGitRepository } from './git-exec'
import type { FileAccessService } from '../files/file-access-service'
import type { GitFileDiffResponse, GitStatusResponse } from '@shared/types/workspace'
import { classifyGitStatus, parseGitPorcelainV1 } from '@shared/workspace/git-status'
import { TEXT_PREVIEW_MAX_BYTES } from '@shared/workspace/file-types'
import { isPathWithin } from '@shared/workspace/path-security'
import { toNativePath } from '@shared/workspace/paths'
import { readFile, stat } from 'node:fs/promises'

function toGitPath(filePath: string): string {
  return filePath.split(path.sep).join('/')
}

export class GitService {
  constructor(private readonly access: FileAccessService) {}

  async status(cwd: string): Promise<GitStatusResponse> {
    const realCwd = await this.access.assertAllowed(cwd, { mustExist: true })
    let repositoryRoot: string | null = null
    try {
      repositoryRoot = toNativePath(
        (await gitExec(realCwd, ['rev-parse', '--show-toplevel'])).trim()
      )
    } catch {
      return { isGitRepository: false, repositoryRoot: null, files: [], additions: 0, deletions: 0 }
    }
    if (!repositoryRoot) {
      return { isGitRepository: false, repositoryRoot: null, files: [], additions: 0, deletions: 0 }
    }

    let porcelain: string
    let numstat: string
    try {
      ;[porcelain, numstat] = await Promise.all([
        gitExec(repositoryRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
        gitExec(repositoryRoot, [
          'diff',
          '--no-color',
          '--no-ext-diff',
          '--numstat',
          'HEAD',
          '--',
          '.'
        ]).catch(() => '')
      ])
    } catch (error) {
      if (isNotAGitRepository(error)) {
        return {
          isGitRepository: false,
          repositoryRoot: null,
          files: [],
          additions: 0,
          deletions: 0
        }
      }
      throw error
    }

    const entries = parseGitPorcelainV1(porcelain)
    const files = entries.flatMap((entry) => {
      const filePath = path.resolve(repositoryRoot!, entry.path)
      if (!isPathWithin(filePath, realCwd) && !isPathWithin(filePath, repositoryRoot!)) return []
      const classified = classifyGitStatus(entry)
      return [
        {
          filePath,
          ...classified,
          indexStatus: entry.indexStatus,
          worktreeStatus: entry.worktreeStatus
        }
      ]
    })

    let additions = 0
    let deletions = 0
    for (const line of numstat.split(/\r?\n/)) {
      if (!line) continue
      const [added, deleted] = line.split('\t', 2)
      const addedCount = Number(added)
      const deletedCount = Number(deleted)
      if (Number.isInteger(addedCount)) additions += addedCount
      if (Number.isInteger(deletedCount)) deletions += deletedCount
    }

    return { isGitRepository: true, repositoryRoot, files, additions, deletions }
  }

  async diff(cwd: string, filePath: string): Promise<GitFileDiffResponse> {
    const realCwd = await this.access.assertAllowed(cwd, { mustExist: true })
    const realFile = await this.access.assertAllowed(filePath)
    let repositoryRoot: string
    try {
      repositoryRoot = toNativePath(
        (await gitExec(realCwd, ['rev-parse', '--show-toplevel'])).trim()
      )
    } catch {
      return { supported: false }
    }
    if (!isPathWithin(realFile, repositoryRoot)) return { supported: false }

    const relativePath = toGitPath(path.relative(repositoryRoot, realFile))
    const porcelain = await gitExec(repositoryRoot, [
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all'
    ])
    const entries = parseGitPorcelainV1(porcelain)
    const entry = entries.find((candidate) => candidate.path === relativePath)
    if (!entry) return { supported: false }
    const classified = classifyGitStatus(entry)

    if (classified.status === 'untracked') {
      try {
        const st = await stat(realFile)
        if (!st.isFile() || st.size > TEXT_PREVIEW_MAX_BYTES) {
          return { supported: true, status: classified.status, patch: '' }
        }
        const content = await readFile(realFile, 'utf8')
        return {
          supported: true,
          status: classified.status,
          patch: createAddedFilePatch(relativePath, content)
        }
      } catch {
        return { supported: true, status: classified.status, patch: '' }
      }
    }

    try {
      const patch = await gitExec(
        repositoryRoot,
        ['diff', '--no-color', '--no-ext-diff', '--unified=3', 'HEAD', '--', relativePath],
        { maxBuffer: TEXT_PREVIEW_MAX_BYTES * 4 }
      )
      return { supported: true, status: classified.status, patch }
    } catch {
      return { supported: true, status: classified.status, patch: '' }
    }
  }
}

function createAddedFilePatch(gitPath: string, content: string): string {
  const hasTrailingNewline = content.endsWith('\n')
  const lines = content.split('\n')
  if (hasTrailingNewline) lines.pop()
  const body = lines.map((line) => `+${line}`).join('\n')
  const noNewlineMarker =
    !hasTrailingNewline && lines.length > 0 ? '\n\\ No newline at end of file' : ''
  return [
    `diff --git a/${gitPath} b/${gitPath}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${gitPath}`,
    `@@ -0,0 +1,${lines.length} @@`,
    `${body}${noNewlineMarker}`
  ].join('\n')
}

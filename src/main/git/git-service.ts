import path from 'node:path'
import { gitExec, isNotAGitRepository } from './git-exec'
import { GitError } from '../services/errors'
import type { FileAccessService } from '../files/file-access-service'
import type {
  GitCommitInfo,
  GitCommitResponse,
  GitFileDiffResponse,
  GitStatusResponse
} from '@shared/types/workspace'
import { classifyGitStatus, parseGitPorcelainV1 } from '@shared/workspace/git-status'
import { TEXT_PREVIEW_MAX_BYTES } from '@shared/workspace/file-types'
import { isPathWithin } from '@shared/workspace/path-security'
import { toNativePath } from '@shared/workspace/paths'
import { readFile, realpath, stat } from 'node:fs/promises'

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
    let branch: string | null = null
    try {
      ;[porcelain, numstat, branch] = await Promise.all([
        gitExec(repositoryRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
        gitExec(repositoryRoot, [
          'diff',
          '--no-color',
          '--no-ext-diff',
          '--numstat',
          'HEAD',
          '--',
          '.'
        ]).catch(() => ''),
        gitExec(repositoryRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])
          .then((value) => value.trim() || null)
          .catch(() => null)
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

    return { isGitRepository: true, repositoryRoot, files, additions, deletions, branch }
  }

  async statusMany(cwds: string[]): Promise<GitStatusResponse[]> {
    return Promise.all(cwds.map((cwd) => this.status(cwd)))
  }

  async diff(cwd: string, filePath: string): Promise<GitFileDiffResponse> {
    const realCwd = await this.access.assertAllowed(cwd, { mustExist: true })
    const allowedFile = await this.access.assertAllowed(filePath)
    const realFile = await realpath(allowedFile).catch(() => {
      if (isPathWithin(allowedFile, cwd)) {
        return path.resolve(realCwd, path.relative(cwd, allowedFile))
      }
      return allowedFile
    })
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
      const hasHead = await gitExec(repositoryRoot, ['rev-parse', '--verify', 'HEAD'])
        .then(() => true)
        .catch(() => false)
      const patch = await gitExec(
        repositoryRoot,
        hasHead
          ? ['diff', '--no-color', '--no-ext-diff', '--unified=3', 'HEAD', '--', relativePath]
          : ['diff', '--cached', '--no-color', '--no-ext-diff', '--unified=3', '--', relativePath],
        { maxBuffer: TEXT_PREVIEW_MAX_BYTES * 4 }
      )
      return { supported: true, status: classified.status, patch }
    } catch {
      return { supported: true, status: classified.status, patch: '' }
    }
  }

  async stage(cwd: string, filePaths: string[]): Promise<void> {
    const { repositoryRoot, relativePaths } = await this.mutablePaths(cwd, filePaths)
    await gitExec(repositoryRoot, ['add', '--', ...relativePaths], { timeout: 60_000 })
  }

  async unstage(cwd: string, filePaths: string[]): Promise<void> {
    const { repositoryRoot, relativePaths } = await this.mutablePaths(cwd, filePaths)
    const hasHead = await gitExec(repositoryRoot, ['rev-parse', '--verify', 'HEAD'])
      .then(() => true)
      .catch(() => false)
    if (hasHead) {
      await gitExec(repositoryRoot, ['restore', '--staged', '--', ...relativePaths], {
        timeout: 60_000
      })
      return
    }
    await gitExec(
      repositoryRoot,
      ['rm', '--cached', '--ignore-unmatch', '-r', '--', ...relativePaths],
      { timeout: 60_000 }
    )
  }

  async commit(cwd: string, message: string): Promise<GitCommitResponse> {
    const repositoryRoot = await this.mutableRepository(cwd)
    const stagedFiles = await gitExec(repositoryRoot, ['diff', '--cached', '--name-only'])
    if (!stagedFiles.trim()) throw new GitError('Nothing is staged to commit.')
    await gitExec(repositoryRoot, ['commit', '-m', message.trim()], { timeout: 120_000 })
    const hash = (await gitExec(repositoryRoot, ['rev-parse', 'HEAD'])).trim()
    return { hash }
  }

  async commitMessageContext(
    cwd: string,
    draft = ''
  ): Promise<{ repositoryRoot: string; summary: string; recentMessages: string[]; draft: string }> {
    const repositoryRoot = await this.repository(cwd)
    const [statText, diffText, messagesText] = await Promise.all([
      gitExec(repositoryRoot, ['diff', '--cached', '--no-color', '--no-ext-diff', '--stat=200']),
      gitExec(repositoryRoot, ['diff', '--cached', '--no-color', '--no-ext-diff', '--unified=3'], {
        maxBuffer: 2 * 1024 * 1024
      }),
      gitExec(repositoryRoot, ['log', '-n', '8', '--no-merges', '--format=%B%x00']).catch(() => '')
    ])
    if (!diffText.trim()) throw new GitError('Nothing is staged to describe.')
    return {
      repositoryRoot,
      summary: summarizeStagedDiff(statText, diffText),
      recentMessages: messagesText
        .split('\0')
        .map((message) => message.trim())
        .filter(Boolean),
      draft: draft.trim()
    }
  }

  async history(cwd: string, limit = 100): Promise<GitCommitInfo[]> {
    const repositoryRoot = await this.repository(cwd)
    const output = await gitExec(repositoryRoot, [
      'log',
      '--all',
      '--topo-order',
      '--decorate=short',
      `--max-count=${limit}`,
      '--format=%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%D%x1f%s%x1e'
    ]).catch((error) => {
      if (/does not have any commits|unknown revision|bad revision/i.test(String(error))) return ''
      throw error
    })
    return output
      .split('\x1e')
      .map((record) => record.replace(/^\s+|\s+$/g, ''))
      .filter(Boolean)
      .flatMap((record) => {
        const [
          hash,
          parents = '',
          author = '',
          email = '',
          authoredAt = '',
          refs = '',
          subject = ''
        ] = record.split('\x1f')
        if (!hash) return []
        return [
          {
            hash,
            parents: parents.split(' ').filter(Boolean),
            author,
            email,
            authoredAt,
            refs: refs
              .split(',')
              .map((ref) => ref.trim())
              .filter(Boolean),
            subject
          }
        ]
      })
  }

  private async repository(cwd: string): Promise<string> {
    const realCwd = await this.access.assertAllowed(cwd, { mustExist: true })
    const repositoryRoot = toNativePath(
      (await gitExec(realCwd, ['rev-parse', '--show-toplevel'])).trim()
    )
    if (!repositoryRoot) throw new GitError('Not a git repository.')
    return repositoryRoot
  }

  private async mutableRepository(cwd: string): Promise<string> {
    const realCwd = await this.access.assertWritable(cwd, { mustExist: true })
    const repositoryRoot = toNativePath(
      (await gitExec(realCwd, ['rev-parse', '--show-toplevel'])).trim()
    )
    if (!repositoryRoot) throw new GitError('Not a git repository.')
    return repositoryRoot
  }

  private async mutablePaths(
    cwd: string,
    filePaths: string[]
  ): Promise<{ repositoryRoot: string; relativePaths: string[] }> {
    const repositoryRoot = await this.mutableRepository(cwd)
    const relativePaths = await Promise.all(
      filePaths.map(async (filePath) => {
        const allowed = await this.access.assertAllowed(filePath)
        const resolved = await realpath(allowed).catch(() => allowed)
        if (!isPathWithin(resolved, repositoryRoot)) {
          throw new GitError('Git path is outside the selected repository.')
        }
        return toGitPath(path.relative(repositoryRoot, resolved))
      })
    )
    return { repositoryRoot, relativePaths: [...new Set(relativePaths)] }
  }
}

const COMMIT_DIFF_BUDGET = 80_000
const COMMIT_FILE_BUDGET = 8_000
const COMMIT_NOISE_FILES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'Cargo.lock',
  'Package.resolved',
  'composer.lock',
  'poetry.lock',
  'Gemfile.lock',
  'go.sum',
  'flake.lock',
  'uv.lock'
])

export function summarizeStagedDiff(statText: string, diffText: string): string {
  const files = splitDiffFiles(diffText)
  const sections = [statText.trim()]
  const omitted: string[] = []
  let spent = 0

  for (const file of files) {
    const name = file.path.split('/').at(-1) ?? file.path
    if (
      COMMIT_NOISE_FILES.has(name) ||
      name.endsWith('.lock') ||
      name.endsWith('.pbxproj') ||
      /(^|\/)(node_modules|vendor|dist|Pods|\.build)\//.test(file.path)
    ) {
      omitted.push(`${file.path} (generated or locked file)`)
      continue
    }
    if (/GIT binary patch|Binary files /.test(file.text)) {
      omitted.push(`${file.path} (binary)`)
      continue
    }
    const text = truncateAtLine(file.text, COMMIT_FILE_BUDGET)
    if (spent + text.length > COMMIT_DIFF_BUDGET) {
      omitted.push(`${file.path} (over the size budget)`)
      continue
    }
    spent += text.length
    sections.push(text)
  }

  if (omitted.length) sections.push(`Not shown in full: ${omitted.join(', ')}`)
  return sections.filter(Boolean).join('\n\n')
}

function splitDiffFiles(diffText: string): Array<{ path: string; text: string }> {
  const chunks = diffText
    .split(/(?=^diff --git )/m)
    .filter((chunk) => chunk.startsWith('diff --git '))
  return chunks.map((text) => {
    const header = text.slice(0, text.indexOf('\n') === -1 ? undefined : text.indexOf('\n'))
    const match = header.match(/ b\/(.+)$/)
    return { path: (match?.[1] ?? header.replace('diff --git ', '')).replace(/^"|"$/g, ''), text }
  })
}

function truncateAtLine(text: string, limit: number): string {
  if (text.length <= limit) return text
  const head = text.slice(0, limit)
  const lastBreak = head.lastIndexOf('\n')
  return `${head.slice(0, lastBreak > 0 ? lastBreak : limit)}\n… file diff truncated`
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

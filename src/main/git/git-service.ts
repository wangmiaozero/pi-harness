import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { gitExec, isNotAGitRepository } from './git-exec'
import { GitError } from '../services/errors'
import type { FileAccessService } from '../files/file-access-service'
import type {
  GitCommitInfo,
  GitCommitDetails,
  GitCommitDiffResponse,
  GitCommitResponse,
  GitActionRequest,
  GitActionResponse,
  GitFileDiffResponse,
  GitPullRequestState,
  GitRepositoryOverview,
  GitStatusResponse
} from '@shared/types/workspace'
import { classifyGitStatus, parseGitPorcelainV1 } from '@shared/workspace/git-status'
import { TEXT_PREVIEW_MAX_BYTES } from '@shared/workspace/file-types'
import { isPathWithin } from '@shared/workspace/path-security'
import { toNativePath } from '@shared/workspace/paths'
import { readFile, realpath, stat } from 'node:fs/promises'

const execFileAsync = promisify(execFile)

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

  async overview(cwd: string): Promise<GitRepositoryOverview> {
    const repositoryRoot = await this.repository(cwd)
    const [currentBranch, branchText, remoteNamesText, stashText, submoduleText] =
      await Promise.all([
        gitExec(repositoryRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
          .then((value) => value.trim() || null)
          .catch(() => null),
        gitExec(repositoryRoot, [
          'for-each-ref',
          '--format=%(refname)%00%(refname:short)%00%(objectname)%00%(upstream:short)%00%(upstream:track)',
          'refs/heads',
          'refs/remotes'
        ]),
        gitExec(repositoryRoot, ['remote']).catch(() => ''),
        gitExec(repositoryRoot, ['stash', 'list', '--format=%gd']).catch(() => ''),
        gitExec(repositoryRoot, ['submodule', 'status', '--recursive']).catch(() => '')
      ])

    const remoteNames = remoteNamesText.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)
    const remotes = await Promise.all(
      remoteNames.map(async (name) => ({
        name,
        url: (await gitExec(repositoryRoot, ['config', '--get', `remote.${name}.url`]).catch(() => '')).trim()
      }))
    )
    const branches = branchText
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((line) => {
        const [fullName = '', name = '', tipHash = '', upstream = '', track = ''] = line.split('\0')
        if (!fullName || !name || fullName.endsWith('/HEAD')) return []
        const type = fullName.startsWith('refs/heads/') ? 'local' : 'remote'
        return [{
          name,
          fullName,
          type,
          tipHash,
          upstream: upstream || null,
          ahead: Number(track.match(/ahead (\d+)/)?.[1] ?? 0),
          behind: Number(track.match(/behind (\d+)/)?.[1] ?? 0),
          current: type === 'local' && name === currentBranch
        } satisfies GitRepositoryOverview['branches'][number]]
      })

    return {
      currentBranch,
      detached: currentBranch === null,
      branches,
      remotes,
      stashCount: stashText.split(/\r?\n/).filter(Boolean).length,
      pullRequests: await githubPullRequests(repositoryRoot, remotes),
      submodules: parseSubmodules(submoduleText)
    }
  }

  async commitDetails(cwd: string, hash: string): Promise<GitCommitDetails> {
    const repositoryRoot = await this.repository(cwd)
    const ref = assertGitRef(hash)
    const [metadata, fileText] = await Promise.all([
      gitExec(repositoryRoot, [
        'show',
        '--no-patch',
        '--decorate=short',
        '--format=%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%D%x1f%s%x1f%b%x1e',
        ref
      ]),
      gitExec(repositoryRoot, [
        'diff-tree',
        '--root',
        '--diff-merges=first-parent',
        '--no-commit-id',
        '--name-status',
        '-r',
        '-M',
        '-C',
        ref
      ])
    ])
    const [record = ''] = metadata.split('\x1e')
    const [resolvedHash, parents = '', author = '', email = '', authoredAt = '', refs = '', subject = '', body = ''] =
      record.trim().split('\x1f')
    if (!resolvedHash) throw new GitError('Commit was not found.')
    return {
      hash: resolvedHash,
      parents: parents.split(' ').filter(Boolean),
      author,
      email,
      authoredAt,
      refs: refs.split(',').map((value) => value.trim()).filter(Boolean),
      subject,
      body: body.trim(),
      files: parseCommitFiles(fileText)
    }
  }

  async commitDiff(cwd: string, hash: string, filePath: string): Promise<GitCommitDiffResponse> {
    const repositoryRoot = await this.repository(cwd)
    const ref = assertGitRef(hash)
    const relativePath = assertRepositoryRelativePath(repositoryRoot, filePath)
    const patch = await gitExec(
      repositoryRoot,
      [
        'show',
        '--format=',
        '--diff-merges=first-parent',
        '--no-color',
        '--no-ext-diff',
        '--unified=3',
        ref,
        '--',
        relativePath
      ],
      { maxBuffer: 2 * 1024 * 1024 }
    )
    const limit = 500_000
    return {
      patch: patch.length > limit ? `${patch.slice(0, limit)}\n…` : patch,
      truncated: patch.length > limit
    }
  }

  async action(input: GitActionRequest): Promise<GitActionResponse> {
    const repositoryRoot = await this.mutableRepository(input.cwd)
    const target = input.target ? assertGitRef(input.target) : null
    const name = input.name ? assertGitRef(input.name) : null
    const upstream = input.upstream ? assertGitRef(input.upstream) : null
    let args: string[]

    switch (input.action) {
      case 'fetch':
        args = ['fetch', '--all', '--prune']
        break
      case 'pull':
        args = ['pull', '--ff-only']
        break
      case 'pull-rebase':
        args = ['pull', '--rebase']
        break
      case 'push':
        args = await this.pushArgs(repositoryRoot, target)
        break
      case 'create-branch':
        if (!name) throw new GitError('Branch name is required.')
        args = ['switch', '-c', name, target ?? 'HEAD']
        break
      case 'checkout-branch':
        if (!target) throw new GitError('Branch is required.')
        args = ['switch', target]
        break
      case 'checkout-remote': {
        if (!target) throw new GitError('Remote branch is required.')
        const localName = target.split('/').slice(1).join('/')
        if (!localName) throw new GitError('Remote branch is invalid.')
        const exists = await gitExec(repositoryRoot, ['show-ref', '--verify', '--quiet', `refs/heads/${localName}`])
          .then(() => true)
          .catch(() => false)
        args = exists ? ['switch', localName] : ['switch', '--track', '-c', localName, target]
        break
      }
      case 'stash':
        args = ['stash', 'push', '-u', ...(input.message?.trim() ? ['-m', input.message.trim()] : [])]
        break
      case 'stash-pop':
        args = ['stash', 'pop']
        break
      case 'merge':
        if (!target) throw new GitError('Branch to merge is required.')
        args = ['merge', '--no-edit', target]
        break
      case 'rebase':
        if (!target) throw new GitError('Rebase target is required.')
        args = ['rebase', target]
        break
      case 'rename-branch':
        if (!target || !name) throw new GitError('Old and new branch names are required.')
        args = ['branch', '-m', target, name]
        break
      case 'delete-branch':
        if (!target) throw new GitError('Branch is required.')
        args = ['branch', '-d', target]
        break
      case 'set-upstream':
        if (!target || !upstream) throw new GitError('Branch and upstream are required.')
        args = ['branch', `--set-upstream-to=${upstream}`, target]
        break
      case 'unset-upstream':
        if (!target) throw new GitError('Branch is required.')
        args = ['branch', '--unset-upstream', target]
        break
    }

    const output = await gitExec(repositoryRoot, args, { timeout: 120_000 })
    const hash = await gitExec(repositoryRoot, ['rev-parse', '--verify', 'HEAD'])
      .then((value) => value.trim() || null)
      .catch(() => null)
    return { hash, message: output.trim() }
  }

  private async pushArgs(repositoryRoot: string, requestedBranch: string | null): Promise<string[]> {
    const branch = requestedBranch ?? await gitExec(repositoryRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
      .then((value) => value.trim())
      .catch(() => '')
    if (!branch) throw new GitError('Cannot push while HEAD is detached.')
    const upstream = await gitExec(repositoryRoot, [
      'for-each-ref',
      '--format=%(upstream:short)',
      `refs/heads/${branch}`
    ])
      .then((value) => value.trim())
      .catch(() => '')
    if (upstream) return ['push', upstream.split('/')[0]!, branch]
    const remote = await gitExec(repositoryRoot, ['remote'])
      .then((value) => value.split(/\r?\n/).map((item) => item.trim()).find(Boolean) ?? '')
      .catch(() => '')
    if (!remote) throw new GitError('No remote is configured for this repository.')
    return ['push', '--set-upstream', remote, branch]
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

function assertGitRef(value: string): string {
  const ref = value.trim()
  if (!ref || ref.length > 512 || ref.startsWith('-') || /[\0\r\n]/.test(ref)) {
    throw new GitError('Invalid git reference.')
  }
  return ref
}

function assertRepositoryRelativePath(repositoryRoot: string, value: string): string {
  const normalized = toGitPath(value.trim()).replace(/^\.\//, '')
  const resolved = path.resolve(repositoryRoot, normalized)
  if (!normalized || normalized.startsWith('-') || !isPathWithin(resolved, repositoryRoot)) {
    throw new GitError('Git path is outside the selected repository.')
  }
  return normalized
}

function parseCommitFiles(output: string): GitCommitDetails['files'] {
  return output.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    const [rawStatus = '', first = '', second = ''] = line.split('\t')
    const status = rawStatus.charAt(0) as GitCommitDetails['files'][number]['status']
    if (!first || !'AMDRCTUXB'.includes(status)) return []
    return [{
      status,
      path: status === 'R' || status === 'C' ? second : first,
      previousPath: status === 'R' || status === 'C' ? first : null
    }]
  })
}

function parseSubmodules(output: string): GitRepositoryOverview['submodules'] {
  return output.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    const marker = line.charAt(0)
    const match = line.slice(1).match(/^([0-9a-f]{40})\s+([^\s]+)(?:\s|$)/i)
    if (!match?.[1] || !match[2]) return []
    const state = marker === '-' ? 'uninitialized' : marker === '+' ? 'modified' : marker === 'U' ? 'conflict' : 'clean'
    return [{ path: match[2], hash: match[1], state }]
  })
}

async function githubPullRequests(
  repositoryRoot: string,
  remotes: GitRepositoryOverview['remotes']
): Promise<GitPullRequestState> {
  const slug = remotes.map((remote) => githubSlug(remote.url)).find(Boolean) ?? null
  if (!slug) {
    return { provider: null, available: false, authenticated: false, message: null, items: [] }
  }
  try {
    await externalExec('gh', ['auth', 'status', '--hostname', 'github.com'], repositoryRoot, 10_000)
  } catch (error) {
    const message = String(error)
    return {
      provider: 'github',
      available: !/ENOENT|not found/i.test(message),
      authenticated: false,
      message: /ENOENT|not found/i.test(message)
        ? 'Install GitHub CLI (gh) to view pull requests.'
        : 'Run `gh auth login` to view pull requests.',
      items: []
    }
  }
  try {
    const output = await externalExec(
      'gh',
      ['pr', 'list', '--repo', slug, '--state', 'open', '--limit', '30', '--json', 'number,title,headRefName,author,url,isDraft'],
      repositoryRoot,
      20_000
    )
    const raw = JSON.parse(output) as Array<{
      number?: number
      title?: string
      headRefName?: string
      author?: { login?: string }
      url?: string
      isDraft?: boolean
    }>
    return {
      provider: 'github',
      available: true,
      authenticated: true,
      message: null,
      items: raw.flatMap((item) =>
        typeof item.number === 'number' && item.title && item.url
          ? [{
              number: item.number,
              title: item.title,
              branch: item.headRefName ?? '',
              author: item.author?.login ?? '',
              url: item.url,
              draft: item.isDraft === true
            }]
          : []
      )
    }
  } catch (error) {
    return {
      provider: 'github',
      available: true,
      authenticated: true,
      message: error instanceof Error ? error.message : String(error),
      items: []
    }
  }
}

function githubSlug(url: string): string | null {
  const match = url.match(/github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i)
  return match?.[1] && match[2] ? `${match[1]}/${match[2]}` : null
}

async function externalExec(
  command: string,
  args: string[],
  cwd: string,
  timeout: number
): Promise<string> {
  try {
    const result = await execFileAsync(command, args, {
      cwd,
      timeout,
      maxBuffer: 2 * 1024 * 1024,
      encoding: 'utf8',
      env: { ...process.env, LC_ALL: 'C' }
    })
    return String(result.stdout)
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr
    throw new GitError(stderr?.trim() || (error instanceof Error ? error.message : String(error)))
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

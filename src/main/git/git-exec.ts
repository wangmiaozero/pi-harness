import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { GitError } from '../services/errors'

const execFileAsync = promisify(execFile)

const GIT_TIMEOUT_MS = 10_000
const GIT_MAX_BUFFER = 8 * 1024 * 1024

export function isNotAGitRepository(error: unknown): boolean {
  if (gitFailureReason(error) === 'not-repository') return true
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : String(error)
  return /not a git repository/i.test(message)
}

export function isEmptyGitHistory(error: unknown): boolean {
  const reason = gitFailureReason(error)
  return reason === 'no-commits' || reason === 'unknown-revision'
}

export async function gitExec(
  cwd: string,
  args: string[],
  options: { timeout?: number; maxBuffer?: number } = {}
): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], {
      timeout: options.timeout ?? GIT_TIMEOUT_MS,
      maxBuffer: options.maxBuffer ?? GIT_MAX_BUFFER,
      env: { ...process.env, LC_ALL: 'C' }
    })
    return stdout
  } catch (error) {
    const failure = normalizeGitFailure(error)
    throw new GitError(failure.message, failure.details, {
      userMessage: failure.userMessage,
      recoverable: true
    })
  }
}

interface GitProcessFailure {
  code?: string | number
  killed?: boolean
  signal?: string
  stderr?: string | Buffer
  stdout?: string | Buffer
}

export interface NormalizedGitFailure {
  message: string
  userMessage: string
  details: {
    reason:
      | 'authentication'
      | 'network'
      | 'local-changes'
      | 'non-fast-forward'
      | 'conflict'
      | 'upstream'
      | 'timeout'
      | 'not-repository'
      | 'no-commits'
      | 'unknown-revision'
      | 'unknown'
    exitCode: string | number | null
    signal: string | null
  }
}

export function normalizeGitFailure(error: unknown): NormalizedGitFailure {
  const processError = (error ?? {}) as GitProcessFailure
  const output = [processError.stderr, processError.stdout]
    .map(toOutputText)
    .filter(Boolean)
    .join('\n')
    .trim()
  const timedOut = processError.killed === true || /timed?\s*out|timeout/i.test(output)

  let reason: NormalizedGitFailure['details']['reason'] = 'unknown'
  let userMessage = 'Git operation failed. Please retry.'

  if (timedOut) {
    reason = 'timeout'
    userMessage = 'The Git operation timed out. Check the network and retry.'
  } else if (/not a git repository/i.test(output)) {
    reason = 'not-repository'
    userMessage = 'The selected folder is not a Git repository.'
  } else if (/does not have any commits|bad default revision ['"]?head/i.test(output)) {
    reason = 'no-commits'
    userMessage = 'This repository does not have any commits yet.'
  } else if (/unknown revision|bad revision|ambiguous argument/i.test(output)) {
    reason = 'unknown-revision'
    userMessage = 'The selected Git revision could not be found.'
  } else if (
    /permission denied \(publickey\)|authentication failed|could not read username|access denied|repository not found/i.test(
      output
    )
  ) {
    reason = 'authentication'
    userMessage = 'Git authentication failed. Check the remote credentials and try again.'
  } else if (
    /could not resolve host|failed to connect|network is unreachable|connection (?:timed out|reset)|could not read from remote repository/i.test(
      output
    )
  ) {
    reason = 'network'
    userMessage = 'The remote repository could not be reached. Check the network and remote access.'
  } else if (
    /no tracking information|has no upstream branch|set-upstream|does not point to a branch/i.test(output)
  ) {
    reason = 'upstream'
    userMessage = 'No upstream branch is configured. Set an upstream branch before pulling.'
  } else if (
    /local changes.*would be overwritten|would be overwritten by|commit your changes or stash|uncommitted changes/i.test(
      output
    )
  ) {
    reason = 'local-changes'
    userMessage = 'Local changes prevent this operation. Commit or stash them, then retry.'
  } else if (/not possible to fast-forward|non-fast-forward|diverging branches/i.test(output)) {
    reason = 'non-fast-forward'
    userMessage = 'The branch cannot be fast-forwarded. Review the history, then merge or rebase.'
  } else if (/\bconflict\b|automatic merge failed|could not apply/i.test(output)) {
    reason = 'conflict'
    userMessage = 'Git found conflicts. Resolve them before retrying.'
  }

  return {
    message: userMessage,
    userMessage,
    details: {
      reason,
      exitCode:
        typeof processError.code === 'string' || typeof processError.code === 'number'
          ? processError.code
          : null,
      signal: typeof processError.signal === 'string' ? processError.signal : null
    }
  }
}

function gitFailureReason(error: unknown): NormalizedGitFailure['details']['reason'] | null {
  if (!(error instanceof GitError)) return null
  const details = error.details as { reason?: unknown } | undefined
  return typeof details?.reason === 'string'
    ? (details.reason as NormalizedGitFailure['details']['reason'])
    : null
}

function toOutputText(value: string | Buffer | undefined): string {
  if (typeof value === 'string') return value.trim()
  return Buffer.isBuffer(value) ? value.toString('utf8').trim() : ''
}

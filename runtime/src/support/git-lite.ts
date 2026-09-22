/**
 * Minimal git CLI helper for Harness Control Plane evidence.
 *
 * Checkpoints, evaluations and artifacts only need HEAD / dirty counts /
 * status / recent commits. Full Git UI stays on the next phase.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { GitStatusResponse } from '../types.js'

export interface CheckpointGitState {
  commit: string | null
  branch: string | null
  dirty: { modified: number; added: number; deleted: number } | null
}

const execFileAsync = promisify(execFile)
const GIT_TIMEOUT_MS = 8_000

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
    windowsHide: true
  })
  return stdout
}

export async function gitHeadInfo(cwd: string): Promise<CheckpointGitState | null> {
  try {
    const [commit, branch, porcelain] = await Promise.all([
      git(cwd, ['rev-parse', 'HEAD']),
      git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
      git(cwd, ['status', '--porcelain'])
    ])
    const dirty = { modified: 0, added: 0, deleted: 0 }
    for (const line of porcelain.split('\n')) {
      const code = line.slice(0, 2)
      if (!code.trim()) continue
      if (code.includes('A') || code.includes('?')) dirty.added += 1
      else if (code.includes('D')) dirty.deleted += 1
      else dirty.modified += 1
    }
    return {
      commit: commit.trim() || null,
      branch: branch.trim() || null,
      dirty
    }
  } catch {
    return null
  }
}

export async function gitStatus(cwd: string): Promise<GitStatusResponse | null> {
  try {
    const [root, porcelain] = await Promise.all([
      git(cwd, ['rev-parse', '--show-toplevel']),
      git(cwd, ['status', '--porcelain'])
    ])
    const files = porcelain
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line.length >= 2)
      .map((line) => {
        const indexStatus = line[0] ?? ' '
        const worktreeStatus = line[1] ?? ' '
        const filePath = line.slice(3).trim()
        const combined = `${indexStatus}${worktreeStatus}`
        const code: GitStatusResponse['files'][number]['code'] = combined.includes('U')
          ? 'U'
          : combined.includes('C')
            ? 'C'
            : combined.includes('A')
              ? 'A'
              : combined.includes('D')
                ? 'D'
                : combined.includes('R')
                  ? 'R'
                  : 'M'
        return {
          filePath,
          status: code === 'A' ? 'added' : code === 'D' ? 'deleted' : 'modified',
          code,
          indexStatus,
          worktreeStatus
        }
      })
    return {
      isGitRepository: true,
      repositoryRoot: root.trim() || cwd,
      files,
      additions: files.filter((file) => file.code === 'A').length,
      deletions: files.filter((file) => file.code === 'D').length
    }
  } catch {
    return { isGitRepository: false, repositoryRoot: null, files: [], additions: 0, deletions: 0 }
  }
}

export async function gitHistory(
  cwd: string,
  limit: number
): Promise<Array<{ hash: string; subject: string; timestamp: number }>> {
  try {
    const stdout = await git(cwd, [
      'log',
      `-n${Math.max(1, Math.min(limit, 100))}`,
      '--format=%H%x09%s%x09%at'
    ])
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [hash, subject, at] = line.split('\t')
        return {
          hash: hash ?? '',
          subject: subject ?? '',
          timestamp: Number(at) * 1000
        }
      })
      .filter((commit) => commit.hash)
  } catch {
    return []
  }
}

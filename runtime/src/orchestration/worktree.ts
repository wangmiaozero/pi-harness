/**
 * Orchestration-owned git worktree create.
 *
 * Layout matches Electron / Rust: `{repo}-worktrees/{sanitized-branch}`.
 * After `git worktree add`, the path is appended to `authorized-roots.json`
 * so the desktop host's file/git APIs accept it (Rust reloads on mtime).
 */

import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { RuntimeError } from '../pi/errors.js'

const execFileAsync = promisify(execFile)
const SHORT_MS = 8_000
const LONG_MS = 120_000

async function git(cwd: string, args: string[], timeoutMs = SHORT_MS): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true
  })
  return String(stdout)
}

function sanitizeBranch(branch: string): string {
  return branch.replace(/[/\\:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '')
}

export async function createGitWorktree(
  cwd: string,
  branch: string
): Promise<{ path: string; branch: string }> {
  const trimmed = branch.trim()
  if (!trimmed) {
    throw new RuntimeError('INVALID_INPUT', 'Branch name is required')
  }
  const dirName = sanitizeBranch(trimmed)
  if (!dirName) {
    throw new RuntimeError('INVALID_INPUT', `Invalid branch name: ${branch}`)
  }
  let commonDir: string
  try {
    commonDir = (await git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim()
  } catch {
    throw new RuntimeError('INVALID_INPUT', 'The selected folder is not a Git repository.')
  }
  const repoRoot = path.dirname(commonDir.replace(/\\/g, '/'))
  const baseDir = `${repoRoot}-worktrees`
  const worktreePath = path.join(baseDir, dirName)
  if (existsSync(worktreePath)) {
    throw new RuntimeError('INVALID_INPUT', `Directory already exists: ${worktreePath}`)
  }
  await mkdir(baseDir, { recursive: true })
  let branchExists = false
  try {
    await git(repoRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${trimmed}`])
    branchExists = true
  } catch {
    branchExists = false
  }
  try {
    if (branchExists) {
      await git(repoRoot, ['worktree', 'add', '--', worktreePath, trimmed], LONG_MS)
    } else {
      await git(repoRoot, ['worktree', 'add', '-b', trimmed, '--', worktreePath], LONG_MS)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new RuntimeError('INTERNAL_ERROR', `Git worktree add failed: ${message}`)
  }
  await authorizeRoot(worktreePath)
  return { path: worktreePath.replace(/\\/g, '/'), branch: trimmed }
}

async function authorizeRoot(worktreePath: string): Promise<void> {
  const dataDir = process.env.PI_HARNESS_USER_DATA
  if (!dataDir) return
  const store = path.join(dataDir, 'authorized-roots.json')
  let roots: string[] = []
  try {
    const raw = JSON.parse(await readFile(store, 'utf8')) as { roots?: unknown }
    if (Array.isArray(raw.roots)) {
      roots = raw.roots.filter((item): item is string => typeof item === 'string' && item.length > 0)
    }
  } catch {
    roots = []
  }
  const normalized = worktreePath.replace(/\\/g, '/')
  if (!roots.includes(normalized)) roots.push(normalized)
  const tmp = `${store}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(tmp, `${JSON.stringify({ roots }, null, 2)}\n`, 'utf8')
  await rename(tmp, store)
}

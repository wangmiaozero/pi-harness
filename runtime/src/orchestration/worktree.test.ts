import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createGitWorktree } from './worktree.js'

const dirs: string[] = []

afterEach(() => {
  while (dirs.length) {
    const dir = dirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
  delete process.env.PI_HARNESS_USER_DATA
})

function initRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'pi-orch-wt-'))
  dirs.push(dir)
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 'wt@test'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 'wt'], { cwd: dir })
  writeFileSync(path.join(dir, 'README.md'), 'hi\n')
  execFileSync('git', ['add', 'README.md'], { cwd: dir })
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir })
  return dir
}

describe('orchestration git worktree', () => {
  it('creates `{repo}-worktrees/{branch}` and records the authorized root', async () => {
    const repo = initRepo()
    const dataDir = mkdtempSync(path.join(tmpdir(), 'pi-orch-data-'))
    dirs.push(dataDir)
    process.env.PI_HARNESS_USER_DATA = dataDir
    const created = await createGitWorktree(repo, 'agent/review')
    expect(created.branch).toBe('agent/review')
    expect(created.path).toContain(`${path.basename(repo)}-worktrees/`)
    expect(existsSync(created.path)).toBe(true)
    const stored = JSON.parse(readFileSync(path.join(dataDir, 'authorized-roots.json'), 'utf8')) as {
      roots: string[]
    }
    expect(stored.roots.some((root) => root.includes('agent-review'))).toBe(true)
  })

  it('rejects an empty branch name', async () => {
    const repo = initRepo()
    await expect(createGitWorktree(repo, '   ')).rejects.toMatchObject({
      code: 'INVALID_INPUT'
    })
  })
})

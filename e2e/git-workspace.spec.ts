import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { test, expect } from './fixtures'

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
}

function seedSession(agentDir: string, cwd: string, id: string) {
  const sessionDir = path.join(
    agentDir,
    'sessions',
    `--${path
      .resolve(cwd)
      .replace(/^[/\\]/, '')
      .replace(/[/\\:]/g, '-')}--`
  )
  fs.mkdirSync(sessionDir, { recursive: true })
  const timestamp = '2026-09-01T01:00:00.000Z'
  fs.writeFileSync(
    path.join(sessionDir, `2026-09-01T01-00-00-000Z_${id}.jsonl`),
    [
      JSON.stringify({ type: 'session', version: 3, id, timestamp, cwd }),
      JSON.stringify({
        type: 'message',
        id: 'user-1',
        parentId: null,
        timestamp,
        message: { role: 'user', content: 'Git workspace', timestamp: Date.parse(timestamp) }
      })
    ].join('\n') + '\n'
  )
}

test('stages, commits, and renders the commit graph without horizontal overflow', async ({
  page,
  piAgentDir,
  workspaceRoot
}) => {
  const repository = path.join(workspaceRoot, 'graph-repository')
  fs.mkdirSync(repository)
  git(repository, ['init', '-b', 'main'])
  git(repository, ['config', 'user.name', 'wangmiao'])
  git(repository, ['config', 'user.email', 'tuziling84@gmail.com'])
  fs.writeFileSync(path.join(repository, 'README.md'), '# Graph repository\n')
  git(repository, ['add', 'README.md'])
  git(repository, ['commit', '-m', 'docs: add repository readme'])
  git(repository, ['checkout', '-b', 'feature/graph'])
  fs.writeFileSync(path.join(repository, 'graph.ts'), 'export const lanes = 2\n')
  git(repository, ['add', 'graph.ts'])
  git(repository, ['commit', '-m', 'feat(git): add graph lanes'])
  git(repository, ['checkout', 'main'])
  fs.writeFileSync(path.join(repository, 'main.ts'), 'export const branch = "main"\n')
  git(repository, ['add', 'main.ts'])
  git(repository, ['commit', '-m', 'feat: add main branch marker'])
  git(repository, ['merge', '--no-ff', 'feature/graph', '-m', 'merge: graph feature'])
  fs.appendFileSync(path.join(repository, 'graph.ts'), 'export const visible = true\n')
  fs.writeFileSync(path.join(repository, 'untracked.ts'), 'export const ready = true\n')

  const sessionId = '01a026a4-0796-73ff-990a-a2be219835ef'
  seedSession(piAgentDir, repository, sessionId)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.evaluate(() => window.piSwitch.settings.set({ theme: 'light' }))
  // Git is a standalone route that reads every workspace project, no session selection needed.
  await page.locator('a[href="#/git"]').click()
  await expect(page.getByTestId('git-view')).toBeVisible()

  const commitPanel = page.getByTestId('git-commit-panel')
  await expect(commitPanel).toBeVisible()
  const repositorySidebar = page.getByTestId('git-repository-sidebar')
  await expect(repositorySidebar.getByRole('button', { name: /^(本地|Local)/ })).toBeVisible()
  await expect(repositorySidebar.getByRole('button', { name: /^(远程|Remote)/ })).toBeVisible()
  await expect(repositorySidebar.getByRole('button', { name: /^(拉取请求|Pull requests)/ })).toBeVisible()
  await expect(repositorySidebar.getByRole('button', { name: /^(子模块|Submodules)/ })).toBeVisible()
  await expect(repositorySidebar.locator('[data-git-branch="main"]')).toBeVisible()
  await expect(repositorySidebar.locator('[data-git-branch="feature/graph"]')).toBeVisible()

  await page.getByTestId('git-pull').click()
  await expect(
    page.getByText('No upstream branch is configured. Set an upstream branch before pulling.')
  ).toBeVisible()
  await expect(page.getByText(/Command failed: git -C/)).toHaveCount(0)

  const graph = page.getByTestId('git-history-graph')
  await expect(graph.locator(':scope > div')).toHaveCount(4)
  await expect(page.getByText(/选择一个变更|Select a change/)).toHaveCount(0)
  expect((await page.getByTestId('git-workspace-view').boundingBox())?.width).toBeGreaterThan(800)

  await graph.locator('[data-git-ref="feature/graph"]').click()
  await expect(page.getByTestId('git-active-ref-filter')).toContainText('feature/graph')
  await expect(graph.locator(':scope > div')).toHaveCount(2)
  await page.getByTestId('git-active-ref-filter').click()
  await expect(graph.locator(':scope > div')).toHaveCount(4)

  await graph.locator(':scope > div').first().click()
  const review = page.getByTestId('git-commit-review')
  await expect(review).toContainText('merge: graph feature')
  await expect(review.getByText(/已更改文件|Changed files/)).toBeVisible()
  await review.getByText('graph.ts', { exact: true }).click()
  const historicalDiff = page.getByTestId('git-historical-diff')
  await expect(historicalDiff).toBeVisible()
  await expect(historicalDiff.getByText('export const lanes = 2', { exact: false })).toBeVisible()
  await expect(graph).toBeHidden()
  await historicalDiff.getByRole('button', { name: /返回图谱|Back to graph/ }).click()
  await expect(graph).toBeVisible()

  await review.getByText('graph.ts', { exact: true }).click()

  const qaDir =
    process.env.PI_HARNESS_DESIGN_QA_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(), 'git-qa-'))
  const qaPath = path.join(qaDir, 'git-workspace-graph.png')
  await page.screenshot({ animations: 'disabled', path: qaPath })

  await commitPanel.getByRole('button', { name: /graph\.ts$/ }).click()
  await expect(page.getByText('export const visible = true', { exact: false })).toBeVisible()
  await expect(page.getByTestId('git-generate-message')).toBeDisabled()
  await commitPanel.getByRole('button', { name: /全部暂存|Stage all/ }).click()
  await expect(page.getByTestId('git-generate-message')).toBeEnabled()

  const overflow = await page.getByTestId('git-view').evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    documentClientWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth
  }))
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth)
  expect(overflow.documentScrollWidth).toBeLessThanOrEqual(overflow.documentClientWidth)

  await commitPanel.getByPlaceholder(/提交信息|Commit message/).fill('feat(git): 集成提交工作流')
  await page.getByTestId('git-create-commit').click()
  await page.getByTestId('git-back-to-graph').click()
  await expect(page.getByTestId('git-history-graph').locator(':scope > div')).toHaveCount(5)
  expect(git(repository, ['log', '-1', '--format=%s']).trim()).toBe('feat(git): 集成提交工作流')
})

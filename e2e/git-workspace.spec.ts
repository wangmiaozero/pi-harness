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
  await page.locator('a[href="#/workspace"]').click()
  await page.getByTestId('workspace-refresh').click()
  await page
    .getByTestId(`session-row-${sessionId}`)
    .getByRole('button', { name: 'Git workspace', exact: true })
    .click()
  await page.getByTestId('workspace-section-git').click()

  const commitPanel = page.getByTestId('git-commit-panel')
  await expect(commitPanel).toBeVisible()
  await expect(page.getByTestId('git-history-graph').locator(':scope > div')).toHaveCount(4)
  await commitPanel.getByRole('button', { name: /graph\.ts$/ }).click()
  await expect(page.getByText('export const visible = true', { exact: false })).toBeVisible()
  await expect(page.getByTestId('git-generate-message')).toBeDisabled()
  await commitPanel.getByRole('button', { name: /全部暂存|Stage all/ }).click()
  await expect(page.getByTestId('git-generate-message')).toBeEnabled()

  const overflow = await page.getByTestId('workspace-scene').evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    documentClientWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth
  }))
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth)
  expect(overflow.documentScrollWidth).toBeLessThanOrEqual(overflow.documentClientWidth)

  const qaDir =
    process.env.PI_HARNESS_DESIGN_QA_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(), 'git-qa-'))
  const qaPath = path.join(qaDir, 'git-workspace-graph.png')
  await page.screenshot({ animations: 'disabled', path: qaPath })

  await commitPanel.getByPlaceholder(/提交信息|Commit message/).fill('feat(git): 集成提交工作流')
  await page.getByTestId('git-create-commit').click()
  await expect(page.getByTestId('git-history-graph').locator(':scope > div')).toHaveCount(5)
  expect(git(repository, ['log', '-1', '--format=%s']).trim()).toBe('feat(git): 集成提交工作流')
})

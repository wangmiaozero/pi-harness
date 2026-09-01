import { describe, expect, it } from 'vitest'
import { cleanCommitMessage, commitUserPrompt } from './commit-message-service'

describe('GitCommitMessageService helpers', () => {
  it('removes common model wrappers without changing the message body', () => {
    expect(cleanCommitMessage('```text\nfeat(git): 添加提交图谱\n\n显示分支历史。\n```')).toBe(
      'feat(git): 添加提交图谱\n\n显示分支历史。'
    )
    expect(cleanCommitMessage('<commit_message>fix: 修复暂存</commit_message>')).toBe(
      'fix: 修复暂存'
    )
  })

  it('includes draft, repository history, and staged diff in the request', () => {
    const prompt = commitUserPrompt({
      repositoryRoot: '/repo',
      summary: 'src/git.ts | 4 ++++',
      recentMessages: ['feat: existing style'],
      draft: 'add git support'
    })
    expect(prompt).toContain('add git support')
    expect(prompt).toContain('feat: existing style')
    expect(prompt).toContain('src/git.ts | 4 ++++')
  })
})

import { describe, expect, it } from 'vitest'
import {
  cleanCommitMessage,
  commitUserPrompt,
  extractCommitMessage,
  formatCommitGenerationError
} from './commit-message-service'

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

  it('rewrites quota and thinking provider errors into a switch-model hint', () => {
    expect(
      formatCommitGenerationError(
        '429 {"error":{"code":"AccountQuotaExceeded","message":"You have exceeded the 5-hour usage quota. It will reset at 2026-09-13 22:50:44 +0800 CST. We recommend upgrading your plan for more quota, or waiting for the reset. Request id: abc","param":"","type":"TooManyRequests"}}'
      )
    ).toBe(
      "This model's quota is exhausted until 2026-09-13 22:50:44 +0800 CST. Switch to another model and retry."
    )
    expect(
      formatCommitGenerationError(
        '400 {"error":{"code":"InvalidParameter","message":"thinking.type disabled is not supported by this model Request id: abc","param":"","type":"BadRequest"}}'
      )
    ).toBe('This model cannot disable thinking. Switch to another model and retry.')
    expect(formatCommitGenerationError('network timeout')).toBe('network timeout')
  })

  it('reads the commit subject from thinking when text parts are empty', () => {
    expect(
      extractCommitMessage([
        {
          type: 'thinking',
          thinking: 'The staged files rename a layout helper.\n\nfeat(ui): 调整提交面板布局'
        }
      ])
    ).toBe('feat(ui): 调整提交面板布局')
    expect(
      cleanCommitMessage('<think>ignore</think><answer>fix: 修复空提交信息</answer>')
    ).toBe('fix: 修复空提交信息')
  })
})

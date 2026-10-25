import { describe, expect, it } from 'vitest'
import { cleanGeneratedSessionTitle, summarizeSessionTitle } from './session-title'

describe('session title previews', () => {
  it('extracts the task heading rather than the project URL or instruction boilerplate', () => {
    expect(
      summarizeSessionTitle([
        '# Pi-Harness 全局主题系统重构\n项目：https://github.com/example/demo\n请直接完成修改。'
      ])
    ).toBe('Pi-Harness 全局主题系统重构')
    expect(summarizeSessionTitle(['hi', '修复会话切换时丢失草稿的问题', '请继续'])).toBe(
      '修复会话切换时丢失草稿的问题'
    )
  })
  it('does not expose URLs, absolute paths or fenced commands in navigation', () => {
    expect(summarizeSessionTitle(['https://github.com/example/pi-harness'])).toBe(
      'Discuss pi-harness'
    )
    const title = summarizeSessionTitle([
      '```sh\ncd /Users/someone/private && pnpm release:package\n```\n请排查安装失败的问题。'
    ])
    expect(title).toBe('排查安装失败的问题')
    expect(title).not.toMatch(/\/Users|```|https:/)
  })
  it('keeps previews bounded and uses a neutral greeting fallback', () => {
    expect(summarizeSessionTitle(['hi'])).toBe('hi')
    expect(summarizeSessionTitle(['请' + '实现项目功能'.repeat(40)]).length).toBeLessThanOrEqual(52)
  })
  it('accepts clean model text but rejects paths, URLs, empty or excessive output', () => {
    expect(cleanGeneratedSessionTitle('标题： “修复会话切换”')).toBe('修复会话切换')
    expect(
      cleanGeneratedSessionTitle('<think>private reasoning</think>\nFix session navigation')
    ).toBe('Fix session navigation')
    for (const text of ['', 'x'.repeat(100), 'https://example.com', '/Users/private/project'])
      expect(cleanGeneratedSessionTitle(text)).toBeNull()
  })
})

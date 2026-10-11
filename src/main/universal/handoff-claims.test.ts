import { describe, expect, it } from 'vitest'
import type { UniversalMessage } from '@shared/universal/schema'
import { extractClaims } from './handoff-claims'

function message(role: UniversalMessage['role'], text: string, record = 1): UniversalMessage {
  return {
    id: `message-${record}`,
    sessionId: 'a'.repeat(64),
    role,
    parts: [{ type: 'text', text }],
    sourceRef: `/fixture/conversation.jsonl#record=${record}`
  }
}

describe('local task claims', () => {
  it('excludes system and tool descriptions without modifying the original history', () => {
    const messages = [
      message(
        'system',
        '- codex-security:propose-security-hardening: Use a completed security scan.'
      ),
      message('tool', 'Example: fixed, tests passed. You must choose a tool.'),
      message('user', '修复 a.ts。禁止推送代码。', 3),
      message('assistant', '已完成修复，测试通过。下一步：增加回归覆盖。', 4)
    ]
    const original = JSON.stringify(messages)
    const claims = extractClaims(messages)
    expect(claims.goal.text).toBe('修复 a.ts。')
    expect(claims.completed).toEqual([
      {
        text: '已完成修复，测试通过。',
        evidence: ['/fixture/conversation.jsonl#record=4'],
        confidence: 'low',
        verification: 'historical-claim'
      }
    ])
    expect(claims.constraints.map((claim) => claim.text)).toEqual(['禁止推送代码。'])
    expect(claims.remaining.map((claim) => claim.text)).toEqual(['下一步：增加回归覆盖。'])
    expect(JSON.stringify(messages)).toBe(original)
  })

  it('filters injected context, skill sections, quotes, tables and code in mixed messages', () => {
    const text = [
      '<app-context>Completed system setup. Never change system instructions.</app-context>',
      '# Skills',
      '### Available skills',
      '- helper: Use after a completed scan. Must verify it.',
      '# My request',
      'Fix the login bug. Never push changes.',
      '<skills_instructions>已完成技能配置。下一步：使用技能。</skills_instructions>',
      '> 已完成引用中的任务。',
      '~~~text',
      'Completed code example. Must run the example.',
      '~~~',
      '```json',
      '{"status":"completed","error":"example"}',
      '```',
      '| Task | Completed |',
      '- helper:catalog: Use a completed scan.',
      '- helper: Use a completed scan. (file: /fixture/SKILL.md)',
      '示例：已完成文档中的任务。',
      '引用：“已完成旧任务”。'
    ].join('\n')
    const claims = extractClaims([message('user', text)])
    expect(claims.goal.text).toBe('Fix the login bug.')
    expect(claims.constraints.map((claim) => claim.text)).toEqual(['Never push changes.'])
    expect(claims.completed).toEqual([])
    expect(claims.remaining).toEqual([])
    expect(claims.unresolvedIssues).toEqual([])
  })

  it.each([
    'The task is not completed.',
    'I have not fixed a.ts.',
    'Tests have not passed.',
    'I will report tests passed after running them.',
    'Please mark the task completed.',
    'Once the task is completed, run the tests.',
    'Has the task been completed?',
    '还未完成修复，不能说测试通过。',
    '尚未实现功能。',
    '请确认已完成修复。',
    '计划在测试通过后提交。',
    '如果测试通过，再继续。',
    '这次已完成修复了吗？',
    'The docs say “tests passed”.',
    'The status field is `completed`.'
  ])(
    'does not treat a request, plan, question, negation or quoted status as completion: %s',
    (text) => {
      expect(extractClaims([message('assistant', text)]).completed).toEqual([])
    }
  )

  it('keeps real user and assistant assertions, decisions and issues with their source evidence', () => {
    const claims = extractClaims([
      message('user', 'Fix login. I completed the initial investigation.', 1),
      message('assistant', '**Implemented** the login fix in `a.ts`. Tests passed.', 2),
      message('assistant', '决定采用现有组件。错误：缓存读取失败。尚未完成回归覆盖。', 3)
    ])
    expect(claims.completed.map((claim) => claim.text)).toEqual([
      'I completed the initial investigation.',
      '**Implemented** the login fix in `a.ts`.',
      'Tests passed.'
    ])
    expect(claims.completed[0]).toMatchObject({
      confidence: 'high',
      verification: 'historical-claim'
    })
    expect(claims.decisions[0]?.text).toBe('决定采用现有组件。')
    expect(claims.unresolvedIssues[0]?.evidence).toEqual(['/fixture/conversation.jsonl#record=3'])
    expect(claims.remaining[0]?.text).toBe('尚未完成回归覆盖。')
  })

  it('does not extract claims from incomplete context or a fence split across text parts', () => {
    const split = message('assistant', '```text')
    split.parts.push({ type: 'text', text: 'Completed example\n```\nFixed the actual bug.' })
    const claims = extractClaims([
      message('user', '<environment_context>Must use a completed scan.'),
      split
    ])
    expect(claims.goal).toMatchObject({ text: '', verification: 'unverified' })
    expect(claims.completed.map((claim) => claim.text)).toEqual(['Fixed the actual bug.'])
    expect(claims.constraints).toEqual([])
  })
})

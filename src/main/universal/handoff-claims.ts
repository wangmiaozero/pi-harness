import type { HandoffClaim, SessionHandoff, UniversalMessage } from '@shared/universal/schema'
import { userTaskText } from './normalize'

const CONTEXT_TAGS =
  'app-context|skills_instructions|environment_context|INSTRUCTIONS|system-reminder|system_prompt|developer_instructions|tool_result|permissions instructions|collaboration_mode|recommended_plugins'
const contextBlock = new RegExp(`<(${CONTEXT_TAGS})(?:\\s[^>]*)?>[\\s\\S]*?<\\/\\1>`, 'gi')
const openContext = new RegExp(`<(${CONTEXT_TAGS})(?:\\s[^>]*)?>`, 'i')
const contextHeading =
  /^(?:skills|available skills|skill roots|tools|tool definitions|codex desktop context|agent instructions|system prompt|技能(?:列表|目录)?|可用技能|系统提示)(?:\s|$|[:：])/i

/** Extract prose only; the original messages and quoted context remain untouched in history. */
function taskProse(value: string): string[] {
  const lines = userTaskText(value).replace(contextBlock, '').split('\n')
  const prose: string[] = []
  let fence: { marker: string; length: number } | undefined
  let ignoredSection: number | undefined
  for (const line of lines) {
    const trimmed = line.trim()
    // An incomplete injected block is safer to omit than to treat as a task assertion.
    if (openContext.test(trimmed)) break
    const delimiter = trimmed.match(/^(`{3,}|~{3,})/)
    if (fence) {
      if (
        delimiter &&
        delimiter[1]![0] === fence.marker &&
        delimiter[1]!.length >= fence.length &&
        /^(`+|~+)\s*$/.test(trimmed)
      )
        fence = undefined
      continue
    }
    if (delimiter) {
      fence = { marker: delimiter[1]![0]!, length: delimiter[1]!.length }
      continue
    }
    const heading = trimmed.match(/^(#{1,6})\s+(.+)/)
    if (heading) {
      const level = heading[1]!.length
      if (ignoredSection !== undefined && level <= ignoredSection) ignoredSection = undefined
      if (contextHeading.test(heading[2]!)) ignoredSection ??= level
      continue
    }
    if (
      ignoredSection !== undefined ||
      !trimmed ||
      /^(?:>|\||[“「『"])/.test(trimmed) ||
      /^(?:[-*]\s+)?[\w.-]+:[\w.-]+:\s/.test(trimmed) ||
      /\(file:\s*.*SKILL\.md\)/i.test(trimmed) ||
      /^(?:示例|例子|引用|原文|例如|example|quote|documentation)\s*[:：]/i.test(trimmed)
    )
      continue
    prose.push(trimmed)
  }
  return prose.flatMap((line) =>
    line
      .split(/(?<=[。！？])\s*|(?<=[.!?])\s+/)
      .map((text) => text.trim())
      .filter(Boolean)
  )
}

function isCompletion(text: string): boolean {
  const plain = text
    .replace(/`[^`]*`|["“「『][^"”」』]*["”」』]/g, '')
    .replace(/^[\s*-]+|^\d+[.)]\s+/g, '')
    .replace(/[*_]/g, '')
  if (
    !/(?:已完成|已实现|已修复|测试通过|\b(?:completed|implemented|fixed|tests? passed)\b)/i.test(
      plain
    )
  )
    return false
  // Requests, future plans, conditions, questions and negated results are not completed work.
  return !(
    /[?？]$/.test(plain) ||
    /^(?:请|帮我|希望|需要|要求|计划|准备|将(?:要)?|如果|待|等到|例如|示例|引用)/.test(plain) ||
    /(?:未(?:完成|实现|修复)|(?:尚未|还未|没有|并未|未能|无法|不能).{0,24}(?:完成|实现|修复|通过))/.test(
      plain
    ) ||
    /\b(?:not|never|no|cannot|can't|haven't|hasn't|didn't|isn't|aren't|wasn't|weren't)\b.{0,32}\b(?:completed|implemented|fixed|passed)\b/i.test(
      plain
    ) ||
    /\b(?:will|would|could|should|must|please|plan(?:ning)? to|going to|need to|want to|once|if|when|unless)\b/i.test(
      plain
    )
  )
}

export function extractClaims(
  messages: UniversalMessage[]
): Pick<
  SessionHandoff,
  'goal' | 'completed' | 'remaining' | 'decisions' | 'constraints' | 'unresolvedIssues'
> {
  const rows = messages.flatMap((message) =>
    message.role === 'user' || message.role === 'assistant'
      ? taskProse(
          message.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n')
        ).map((text) => ({
          text: text.slice(0, 2000),
          evidence: [message.sourceRef],
          role: message.role
        }))
      : []
  )
  const claim = (row: (typeof rows)[number]): HandoffClaim => ({
    text: row.text,
    evidence: row.evidence,
    confidence: row.role === 'user' ? 'high' : 'low',
    verification: 'historical-claim'
  })
  const select = (matches: (text: string) => boolean) =>
    rows
      .filter((row) => matches(row.text))
      .slice(-20)
      .map(claim)
  const goal = rows.find((row) => row.role === 'user')
  return {
    goal: goal
      ? claim(goal)
      : { text: '', evidence: [], confidence: 'low', verification: 'unverified' },
    completed: select(isCompletion),
    remaining: select((text) =>
      /(?:待办|剩余|下一步|尚未|未完成|\b(?:todo|remaining|next step|not yet)\b)/i.test(text)
    ),
    decisions: select((text) => /(?:决定|采用|选择|\b(?:decided|decision|chosen)\b)/i.test(text)),
    constraints: select((text) =>
      /(?:必须|禁止|不得|只读|\b(?:must|never|read.only|constraint)\b)/i.test(text)
    ),
    unresolvedIssues: select((text) =>
      /(?:失败|错误|未解决|\b(?:failed|error|unresolved|blocked)\b)/i.test(text)
    )
  }
}

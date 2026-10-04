export interface ActiveSkillMention {
  start: number
  end: number
  query: string
}

export interface ResolvedSkillInvocation {
  name: string
  prompt: string
  runtimeText: string
}

export { parseSkillInvocation } from '@shared/skills/skill-invocation'

export function findActiveSkillMention(
  text: string,
  cursor: number | null
): ActiveSkillMention | null {
  if (cursor === null || cursor < 0 || cursor > text.length) return null
  const beforeCursor = text.slice(0, cursor)
  const match = beforeCursor.match(/(^|\s)@([a-zA-Z0-9._-]*)$/)
  if (!match) return null

  const query = match[2]
  const start = cursor - query.length - 1
  let end = cursor
  while (end < text.length && /[a-zA-Z0-9._-]/.test(text[end])) end += 1
  return { start, end, query }
}

export function replaceSkillMention(
  text: string,
  mention: ActiveSkillMention,
  skillName: string
): { text: string; cursor: number } {
  const suffix = text.slice(mention.end)
  const needsSpace = suffix.length > 0 && !/^\s/.test(suffix)
  const replacement = `@${skillName}${needsSpace ? ' ' : suffix ? '' : ' '}`
  return {
    text: `${text.slice(0, mention.start)}${replacement}${suffix}`,
    cursor: mention.start + replacement.length
  }
}

export function resolveSkillMention(
  text: string,
  skillNames: readonly string[]
): ResolvedSkillInvocation | null {
  const names = [...new Set(skillNames)].sort((a, b) => b.length - a.length)
  let selected: { name: string; index: number } | null = null
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = new RegExp(`(^|\\s)@${escaped}(?=\\s|$)`).exec(text)
    if (!match) continue
    const index = match.index + match[1].length
    if (!selected || index < selected.index) {
      selected = { name, index }
    }
  }
  if (!selected) return null

  const start = selected.index
  const end = start + selected.name.length + 1
  const before = text.slice(0, start).trimEnd()
  const after = text.slice(end).trimStart()
  const prompt = before && after ? `${before} ${after}` : before || after
  return {
    name: selected.name,
    prompt,
    runtimeText: prompt ? `/skill:${selected.name} ${prompt}` : `/skill:${selected.name}`
  }
}

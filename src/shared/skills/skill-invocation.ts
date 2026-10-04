export interface ParsedSkillInvocation {
  name: string
  prompt: string
}

export function parseSkillInvocation(text: string): ParsedSkillInvocation | null {
  const native = text.match(/^\/skill:([a-zA-Z0-9._-]+)(?:\s+([\s\S]*))?$/)
  if (native) return { name: native[1], prompt: native[2]?.trim() ?? '' }

  const expanded = text.match(
    /^<skill name="([^"]+)" location="[^"]+">\n[\s\S]*?\n<\/skill>(?:\n\n([\s\S]+))?$/
  )
  if (!expanded) return null
  return { name: expanded[1], prompt: expanded[2]?.trim() ?? '' }
}

export function formatSkillInvocationSummary(text: string): string {
  const invocation = parseSkillInvocation(text)
  if (!invocation) return text
  return invocation.prompt ? `@${invocation.name} ${invocation.prompt}` : `@${invocation.name}`
}

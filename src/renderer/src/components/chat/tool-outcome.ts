import type { ToolCallContent, ToolResultMessage } from '@shared/types/workspace'

export type ToolOutcome = 'pending' | 'success' | 'no-match' | 'error'

/** Accept one literal rg invocation only, never infer the result of a shell program. */
function isSimpleSearch(command: unknown): boolean {
  if (typeof command !== 'string' || !/^rg\s+/.test(command.trim())) return false
  let quote = ''
  for (let i = 0; i < command.length; i++) {
    const char = command[i]
    if (char === '\n' || char === '\r') return false
    if (quote === "'") {
      if (char === "'") quote = ''
    } else if (char === '$' || char === '`') return false
    else if (char === '\\') i++
    else if (quote) {
      if (char === quote) quote = ''
    } else if (char === "'" || char === '"') quote = char
    else if (/[|;&<>()]/.test(char)) return false
  }
  return !quote
}

export function toolExitCode(result?: ToolResultMessage): number | undefined {
  const details = result?.details as { exitCode?: unknown } | undefined
  if (typeof details?.exitCode === 'number') return details.exitCode
  const text = result?.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
  const match = text?.match(/(?:^|\n)Command exited with code (-?\d+)\s*$/)
  return match ? Number(match[1]) : undefined
}

/** Presentation only. Preserve Native isError, output, exit codes and persisted messages. */
export function toolOutcome(
  block: ToolCallContent | undefined,
  result?: ToolResultMessage
): ToolOutcome {
  if (!result) return 'pending'
  const text = result.content
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('\n')
    .trim()
  if (!result.isError)
    return (block?.toolName ?? result.toolName) === 'grep' && text === 'No matches found'
      ? 'no-match'
      : 'success'
  const details = result.details as { cancelled?: boolean } | undefined
  if (
    block?.toolName === 'bash' &&
    isSimpleSearch(block.input.command) &&
    !details?.cancelled &&
    toolExitCode(result) === 1 &&
    result.content.every((item) => item.type === 'text') &&
    !text.replace(/(?:^|\n)Command exited with code 1\s*$/, '').trim()
  )
    return 'no-match'
  return 'error'
}

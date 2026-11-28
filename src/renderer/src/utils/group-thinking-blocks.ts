function isThinking<T extends { type: string }>(
  block: T
): block is Extract<T, { type: 'thinking' }> {
  return block.type === 'thinking'
}

/** Combine adjacent thinking for display while retaining each original block's position. */
export function groupThinkingBlocks<T extends { type: string }>(
  blocks: readonly T[],
  thinkingText: (block: Extract<T, { type: 'thinking' }>) => string | undefined
) {
  const sections: Array<{ block: T; index: number; thinking?: string[] }> = []
  blocks.forEach((block, index) => {
    if (!isThinking(block)) {
      sections.push({ block, index })
      return
    }
    const text = thinkingText(block)
    if (text === undefined) return
    const previous = sections.at(-1)?.thinking
    if (previous) previous.push(text)
    else sections.push({ block, index, thinking: [text] })
  })
  return sections
}

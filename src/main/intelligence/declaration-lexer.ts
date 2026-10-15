/** A declaration lexer, not a type checker. Comments and string bodies never become code tokens. */
export interface DeclarationToken {
  kind: 'word' | 'string' | 'punctuation' | 'newline'
  value: string
  line: number
}
export function lexDeclarations(
  text: string,
  language: 'Python' | 'Go' | 'Java' | 'Rust'
): {
  tokens: DeclarationToken[]
  valid: boolean
} {
  const tokens: DeclarationToken[] = []
  let index = 0
  let line = 1
  const advance = (end: number) => {
    line += (text.slice(index, end).match(/\n/g) ?? []).length
    index = end
  }
  if (language === 'Java' && /\\u+[0-9a-fA-F]{4}/.test(text)) return { tokens, valid: false }
  while (index < text.length) {
    const start = index
    const char = text[index]
    if (char === '\n') {
      tokens.push({ kind: 'newline', value: '\n', line })
      advance(index + 1)
    } else if (/\s/.test(char)) advance(index + 1)
    else if (
      (language === 'Python' && char === '#') ||
      (language !== 'Python' && text.startsWith('//', index))
    ) {
      const end = text.indexOf('\n', index)
      advance(end < 0 ? text.length : end)
    } else if (language !== 'Python' && text.startsWith('/*', index)) {
      let depth = 1
      index += 2
      while (index < text.length && depth) {
        if (language === 'Rust' && text.startsWith('/*', index)) {
          depth++
          index += 2
        } else if (text.startsWith('*/', index)) {
          depth--
          index += 2
        } else index++
      }
      if (depth) return { tokens, valid: false }
      const end = index
      index = start
      advance(end)
    } else {
      const raw = language === 'Rust' ? text.slice(index).match(/^(?:br|r)(#+)?"/) : null
      if (raw) {
        const closing = `"${raw[1] ?? ''}`
        const end = text.indexOf(closing, index + raw[0].length)
        if (end < 0) return { tokens, valid: false }
        tokens.push({ kind: 'string', value: '', line })
        advance(end + closing.length)
        continue
      }
      const lifetimeToken =
        language === 'Rust' ? text.slice(index).match(/^'[A-Za-z_]\w*/)?.[0] : undefined
      const lifetime = !!lifetimeToken && text[index + lifetimeToken.length] !== "'"
      if ((char === '"' || char === "'" || (language === 'Go' && char === '`')) && !lifetime) {
        const triple =
          (language === 'Python' || language === 'Java') && text.startsWith(char.repeat(3), index)
        const delimiter = triple ? char.repeat(3) : char
        let end = index + delimiter.length
        while (end < text.length && !text.startsWith(delimiter, end)) {
          if (text[end] === '\\' && char !== '`') end += 2
          else end++
        }
        if (end >= text.length) return { tokens, valid: false }
        let value = text.slice(index + delimiter.length, end)
        if (value.includes('\\')) {
          try {
            value = char === '"' && !triple ? JSON.parse(text.slice(index, end + 1)) : ''
          } catch {
            value = ''
          }
        }
        tokens.push({ kind: 'string', value: triple ? '' : value, line })
        advance(end + delimiter.length)
      } else {
        const word = text.slice(index).match(/^[A-Za-z_$][\w$]*/)?.[0]
        const value = word ?? (text.startsWith('::', index) ? '::' : char)
        tokens.push({ kind: word ? 'word' : 'punctuation', value, line })
        advance(index + value.length)
      }
    }
  }
  const delimiters: string[] = []
  for (const token of tokens) {
    if (token.kind !== 'punctuation') continue
    if (['(', '[', '{'].includes(token.value)) delimiters.push(token.value)
    if (
      [')', ']', '}'].includes(token.value) &&
      delimiters.pop() !== ({ ')': '(', ']': '[', '}': '{' } as Record<string, string>)[token.value]
    )
      return { tokens, valid: false }
  }
  return { tokens, valid: delimiters.length === 0 }
}

import { expect, it } from 'vitest'
import { lexDeclarations } from './declaration-lexer'

it('keeps Rust lifetimes distinct from character and raw string literals', () => {
  const result = lexDeclarations(
    `fn borrow<'a>(x: &'a str) -> &'a str { x }
const CH: char = 'x';
const DATA: &str = r###"mod fictional; use hidden::x;"###;
/* outer /* mod fake; */ inner */
mod real;`,
    'Rust'
  )
  expect(result.valid).toBe(true)
  expect(
    result.tokens.filter((token) => token.kind === 'word' && token.value === 'mod')
  ).toHaveLength(1)
})
it('excludes Java text blocks and refuses Unicode preprocessing and unbalanced source', () => {
  const result = lexDeclarations(
    'package demo; class A { String x = """\nimport fictional.Type;\n"""; }',
    'Java'
  )
  expect(result.valid).toBe(true)
  expect(result.tokens.some((token) => token.kind === 'word' && token.value === 'import')).toBe(
    false
  )
  expect(lexDeclarations('\\u0069mport fake.Type;', 'Java').valid).toBe(false)
  expect(lexDeclarations('package demo; class A {', 'Java').valid).toBe(false)
})

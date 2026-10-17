// @vitest-environment node
import { expect, it } from 'vitest'
import { javascriptImports } from './javascript-imports'

it('extracts native JavaScript and TypeScript imports with source locations', () => {
  expect(
    javascriptImports(
      [
        'import type { Item } from "./types"',
        'export { value } from "./shared"',
        'export * from "./all"',
        'import legacy = require("./legacy")',
        'const lazy = import("./lazy")',
        'const common = require("./common")',
        'const ignored = require(variable)',
        '// import("./comment")',
        'const quoted = "require(\\"./string\\")"'
      ].join('\n'),
      false
    )
  ).toEqual([
    { spec: './types', line: 1 },
    { spec: './shared', line: 2 },
    { spec: './all', line: 3 },
    { spec: './legacy', line: 4 },
    { spec: './lazy', line: 5 },
    { spec: './common', line: 6 }
  ])
})
it('handles TSX and ignores nonliteral imports and locally bound require functions', () => {
  expect(javascriptImports('import View from "./view"; const node = <View />', true)).toEqual([
    { spec: './view', line: 1 }
  ])
  for (const binding of [
    'const require = custom;',
    'function f({ require }) {}',
    'const [require] = values;',
    'import require from "./adapter";'
  ]) {
    expect(
      javascriptImports(`${binding}\nrequire("./untrusted"); import("./real")`, false).map(
        (entry) => entry.spec
      )
    ).not.toContain('./untrusted')
  }
  expect(javascriptImports('import(variable)', false)).toEqual([])
  expect(javascriptImports('const = ', false)).toEqual([])
})
it('retains dependencies in decorated TypeScript and top-level await scripts', () => {
  expect(
    javascriptImports('import { Inject } from "./di"; @Inject() class Service {}', false)
  ).toEqual([{ spec: './di', line: 1 }])
  expect(javascriptImports('await import("./startup")', false)).toEqual([
    { spec: './startup', line: 1 }
  ])
})

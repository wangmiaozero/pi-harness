import { parse } from '@babel/parser'
import { VISITOR_KEYS, type Node } from '@babel/types'

/** Parse bounded scanner text only; resolving declarations never executes project code. */
export function javascriptImports(
  text: string,
  tsx: boolean
): Array<{ spec: string; line: number }> {
  const declarations: Array<{ spec: string; line: number }> = []
  let tree: Node
  try {
    tree = parse(text, {
      sourceType: 'unambiguous',
      plugins: tsx
        ? ['typescript', 'jsx', 'decorators-legacy']
        : ['typescript', 'decorators-legacy'],
      errorRecovery: true,
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true
    })
  } catch {
    return declarations
  }
  function walk(node: Node, visit: (node: Node) => void): void {
    visit(node)
    for (const key of VISITOR_KEYS[node.type] ?? []) {
      const child = (node as unknown as Record<string, unknown>)[key]
      for (const value of Array.isArray(child) ? child : [child])
        if (value && typeof value === 'object' && 'type' in value) walk(value as Node, visit)
    }
  }
  let shadowedRequire = false
  const requireBinding = (node: Node | null | undefined): boolean => {
    if (!node) return false
    if (node.type === 'Identifier') return node.name === 'require'
    if (node.type === 'AssignmentPattern') return requireBinding(node.left)
    if (node.type === 'RestElement') return requireBinding(node.argument)
    if (node.type === 'ObjectPattern')
      return node.properties.some((property) =>
        requireBinding(property.type === 'RestElement' ? property.argument : property.value)
      )
    if (node.type === 'ArrayPattern') return node.elements.some(requireBinding)
    return false
  }
  walk(tree, (node) => {
    if (
      (node.type === 'VariableDeclarator' && requireBinding(node.id)) ||
      (node.type === 'ImportDeclaration' &&
        node.specifiers.some((item) => requireBinding(item.local))) ||
      (node.type === 'TSImportEqualsDeclaration' && requireBinding(node.id)) ||
      ([
        'FunctionDeclaration',
        'FunctionExpression',
        'ArrowFunctionExpression',
        'ObjectMethod',
        'ClassMethod'
      ].includes(node.type) &&
        (('id' in node && requireBinding(node.id as Node)) ||
          ('params' in node && (node.params as Node[]).some(requireBinding))))
    )
      shadowedRequire = true
  })
  const add = (value: Node | null | undefined, node: Node): void => {
    if (value?.type === 'StringLiteral')
      declarations.push({ spec: value.value, line: node.loc?.start.line ?? 1 })
  }
  walk(tree, (node) => {
    if (
      node.type === 'ImportDeclaration' ||
      node.type === 'ExportNamedDeclaration' ||
      node.type === 'ExportAllDeclaration'
    )
      add(node.source, node)
    if (
      node.type === 'TSImportEqualsDeclaration' &&
      node.moduleReference.type === 'TSExternalModuleReference'
    )
      add(node.moduleReference.expression, node)
    if (node.type === 'ImportExpression') add(node.source, node)
    if (
      node.type === 'CallExpression' &&
      !shadowedRequire &&
      node.callee.type === 'Identifier' &&
      node.callee.name === 'require' &&
      node.arguments.length === 1
    )
      add(node.arguments[0], node)
  })
  return declarations
}

/** Babel's scope analysis does not count TypeScript type references as variable uses. */
export const typeReferences = {
  meta: { type: 'problem', schema: [] },
  create(context) {
    const mark = (node) => {
      if (!node) return
      if (node.type === 'Identifier') context.sourceCode.markVariableAsUsed(node.name, node)
      else if (node.type === 'TSQualifiedName') mark(node.left)
      else if (node.type === 'RestElement') mark(node.argument)
      else if (node.type === 'AssignmentPattern') mark(node.left)
    }
    const parameters = (node) => (node.parameters ?? node.params ?? []).forEach(mark)
    return {
      TSTypeReference: (node) => mark(node.typeName),
      TSTypeQuery: (node) => mark(node.exprName),
      TSInterfaceHeritage: (node) => mark(node.expression),
      TSClassImplements: (node) => mark(node.expression),
      TSParameterProperty: (node) => mark(node.parameter),
      TSFunctionType: parameters,
      TSConstructorType: parameters,
      TSMethodSignature: parameters,
      TSCallSignatureDeclaration: parameters,
      TSConstructSignatureDeclaration: parameters
    }
  }
}

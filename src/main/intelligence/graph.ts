import path from 'node:path'
import { randomUUID } from 'node:crypto'
import ts from 'typescript'
import { parse as parseVue } from 'vue/compiler-sfc'
import { architectureGraphSchema, type ArchitectureGraph } from '@shared/intelligence/schema'
import { hash, workspaceId, type Scan } from './scanner'
import { dependencyResolver, discoverPackages } from './project-metadata'

export function extractGraph(root: string, scan: Scan): ArchitectureGraph {
  const nodeId = (p: string) => `n-${hash(p).slice(0, 16)}`
  const source = (f: Scan['files'][number], line: number) => ({
    path: f.path,
    startLine: line,
    endLine: line,
    hash: f.hash
  })
  const files = new Map(scan.files.map((f) => [f.path, f]))
  const packages = discoverPackages(files)
  const resolve = dependencyResolver(files, packages)
  const nodes = scan.files.map((f) => ({
    id: nodeId(f.path),
    name: f.path,
    type: /(?:^|\/)(?:test|tests|__tests__)\/|\.(?:test|spec)\./.test(f.path)
      ? 'test'
      : /(?:route|controller|api)/i.test(f.path)
        ? 'api'
        : /(?:store|database|repository|model)/i.test(f.path)
          ? 'data'
          : /\.(?:vue|tsx|jsx)$/.test(f.path)
            ? 'ui'
            : 'source',
    description: '',
    packageManifest: packages
      .filter((pkg) => pkg.directory === '.' || f.path.startsWith(`${pkg.directory}/`))
      .sort((a, b) => b.directory.length - a.directory.length)[0]?.manifest,
    evidence: /(?:route|controller|api|store|database|repository|model)/i.test(f.path)
      ? ('unverified' as const)
      : ('static-verified' as const),
    sourceReferences: [source(f, 1)]
  }))
  const edges: ArchitectureGraph['edges'] = []
  for (const f of scan.files) {
    const declarations: Array<{ spec: string; line: number }> = []
    const scripts: Array<{ text: string; offset: number; tsx: boolean }> = []
    if (f.path.endsWith('.vue')) {
      const parsed = parseVue(f.text, { filename: f.path })
      if (!parsed.errors.length)
        for (const script of [parsed.descriptor.script, parsed.descriptor.scriptSetup]) {
          if (!script) continue
          if (script.src) declarations.push({ spec: script.src, line: script.loc.start.line })
          else
            scripts.push({
              text: script.content,
              offset: script.loc.start.line - 1,
              tsx: script.lang === 'tsx' || script.lang === 'jsx'
            })
        }
    } else if (/\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts)$/.test(f.path))
      scripts.push({ text: f.text, offset: 0, tsx: /\.(?:tsx|jsx)$/.test(f.path) })
    for (const script of scripts) {
      const sourceFile = ts.createSourceFile(
        f.path,
        script.text,
        ts.ScriptTarget.Latest,
        true,
        script.tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS
      )
      let shadowedRequire = false
      function bindings(node: ts.Node): void {
        if (
          ((ts.isVariableDeclaration(node) ||
            ts.isParameter(node) ||
            ts.isFunctionDeclaration(node) ||
            ts.isImportClause(node)) &&
            node.name &&
            ts.isIdentifier(node.name) &&
            node.name.text === 'require') ||
          (ts.isImportSpecifier(node) && node.name.text === 'require')
        )
          shadowedRequire = true
        ts.forEachChild(node, bindings)
      }
      bindings(sourceFile)
      function add(spec: string, node: ts.Node): void {
        declarations.push({
          spec,
          line:
            script.offset +
            sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line +
            1
        })
      }
      function visit(node: ts.Node): void {
        if (
          (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
          node.moduleSpecifier &&
          ts.isStringLiteral(node.moduleSpecifier)
        )
          add(node.moduleSpecifier.text, node)
        if (
          ts.isImportEqualsDeclaration(node) &&
          ts.isExternalModuleReference(node.moduleReference) &&
          node.moduleReference.expression &&
          ts.isStringLiteral(node.moduleReference.expression)
        )
          add(node.moduleReference.expression.text, node)
        if (
          ts.isCallExpression(node) &&
          node.arguments.length === 1 &&
          ts.isStringLiteral(node.arguments[0]) &&
          (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
            (!shadowedRequire &&
              ts.isIdentifier(node.expression) &&
              node.expression.text === 'require'))
        )
          add(node.arguments[0].text, node)
        ts.forEachChild(node, visit)
      }
      visit(sourceFile)
    }
    for (const declaration of declarations) {
      const resolved = resolve(f.path, declaration.spec)
      const target = resolved?.target
      if (!target || target === f.path || edges.length >= 1200) continue
      const id = `${nodeId(f.path)}-${nodeId(target)}`
      if (!edges.some((e) => e.id === id))
        edges.push({
          id,
          source: nodeId(f.path),
          target: nodeId(target),
          relation: 'imports',
          evidence: 'static-verified',
          sourceReferences: [
            source(f, declaration.line),
            ...(resolved?.evidence ?? []).slice(0, 9).map((p) => source(files.get(p)!, 1))
          ]
        })
    }
  }
  return architectureGraphSchema.parse({
    schemaVersion: 1,
    workspaceId: workspaceId(root),
    snapshotId: randomUUID(),
    project: {
      name: path.basename(root),
      languages: scan.languages,
      frameworks: scan.frameworks,
      packageManagers: scan.packageManagers,
      packages: packages.map(({ name, manifest, entrypoints }) => ({ name, manifest, entrypoints }))
    },
    revision: {
      createdAt: new Date().toISOString(),
      commit: scan.commit,
      branch: scan.branch,
      fingerprint: scan.fingerprint,
      analyzerVersion: 1,
      archifyVersion: null,
      rendererProvider: 'none',
      modelId: null,
      durationMs: 0
    },
    nodes,
    edges,
    entrypoints: [
      ...new Set([
        ...packages.flatMap((pkg) => pkg.entrypoints),
        ...scan.files
          .filter((f) => /(?:^|\/)(?:main|index|app|server)\.[a-z]+$/.test(f.path))
          .map((f) => f.path)
      ])
    ].slice(0, 50),
    summary: `${scan.files.length} source/configuration files; ${edges.length} verified static import relationships; ${packages.length} package manifests.`,
    warnings: [
      'Static import relationships are not verified runtime data flows. Local TS/JS/Vue imports, configured paths and package entrypoints are resolved only to scanned files. Other languages are indexed by file; computed imports and external dependencies may be omitted.',
      ...(scan.coverage.partial ? ['Scan limit reached. This is a partial analysis.'] : [])
    ],
    coverage: scan.coverage
  })
}

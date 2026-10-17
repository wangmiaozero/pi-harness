import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { javascriptImports } from './javascript-imports'
import { parse as parseVue } from 'vue/compiler-sfc'
import { architectureGraphSchema, type ArchitectureGraph } from '@shared/intelligence/schema'
import { hash, workspaceId, type Scan } from './scanner'
import { dependencyResolver, discoverPackages } from './project-metadata'
import { analyzeLanguageDependencies } from './language-dependencies'

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
  const languageAnalysis = analyzeLanguageDependencies(scan)
  const allPackages = [
    ...packages.map(({ name, manifest, entrypoints }) => ({ name, manifest, entrypoints })),
    ...languageAnalysis.packages
  ].slice(0, 100)
  const resolve = dependencyResolver(files, packages)
  const nodes: ArchitectureGraph['nodes'] = scan.files.map((f) => ({
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
    packageManifest: allPackages
      .filter(
        (pkg) =>
          pkg.manifest === f.path ||
          (/\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts|vue)$/.test(f.path)
            ? pkg.manifest.endsWith('package.json')
            : f.path.endsWith('.py')
              ? pkg.manifest.endsWith('pyproject.toml')
              : f.path.endsWith('.rs')
                ? pkg.manifest.endsWith('Cargo.toml')
                : f.path.endsWith('.go')
                  ? pkg.manifest.endsWith('go.mod')
                  : f.path.endsWith('.java')
                    ? /(?:pom\.xml|build\.gradle(?:\.kts)?)$/.test(pkg.manifest)
                    : false)
      )
      .map((pkg) => ({ ...pkg, directory: path.posix.dirname(pkg.manifest) }))
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
      declarations.push(
        ...javascriptImports(script.text, script.tsx).map((entry) => ({
          spec: entry.spec,
          line: script.offset + entry.line
        }))
      )
    }
    for (const declaration of declarations) {
      const resolved = resolve(f.path, declaration.spec)
      const target = resolved?.target
      const language = f.path.endsWith('.vue')
        ? 'Vue'
        : /\.(?:ts|tsx|mts|cts)$/.test(f.path)
          ? 'TypeScript'
          : 'JavaScript'
      const coverage = languageAnalysis.analysis.languages.find(
        (entry) => entry.language === language
      )
      if (coverage) {
        if (target) coverage.resolved++
        else coverage.unresolved++
      }
      if (!target) {
        if (languageAnalysis.analysis.diagnostics.length < 200)
          languageAnalysis.analysis.diagnostics.push({
            code: 'UNRESOLVED_DEPENDENCY',
            path: f.path,
            line: declaration.line,
            specifier: declaration.spec.slice(0, 500)
          })
        else languageAnalysis.analysis.diagnosticsTruncated = true
      }
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
  nodes.push(...languageAnalysis.nodes)
  for (const relationship of languageAnalysis.relationships) {
    if (edges.length >= 1200) {
      languageAnalysis.analysis.diagnosticsTruncated = true
      break
    }
    const file = scan.files.find((file) => nodeId(file.path) === relationship.source)!
    const id = `${relationship.source}-${relationship.target}`
    if (edges.some((edge) => edge.id === id)) continue
    edges.push({
      id,
      source: relationship.source,
      target: relationship.target,
      relation: relationship.relation,
      evidence: 'static-verified',
      sourceReferences: [
        source(file, relationship.line),
        ...[...new Set(relationship.evidence)]
          .slice(0, 9)
          .flatMap((manifest) => (files.has(manifest) ? [source(files.get(manifest)!, 1)] : []))
      ]
    })
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
      packages: allPackages
    },
    revision: {
      createdAt: new Date().toISOString(),
      commit: scan.commit,
      branch: scan.branch,
      fingerprint: scan.fingerprint,
      analyzerVersion: 2,
      archifyVersion: null,
      rendererProvider: 'none',
      modelId: null,
      durationMs: 0
    },
    nodes,
    edges,
    analysis: languageAnalysis.analysis,
    entrypoints: [
      ...new Set([
        ...[...packages, ...languageAnalysis.packages].flatMap((pkg) => pkg.entrypoints),
        ...scan.files
          .filter((f) =>
            /(?:^|\/)(?:main|index|app|server)\.(?:ts|tsx|js|jsx|mjs|cjs|mts|cts|vue)$/.test(f.path)
          )
          .map((f) => f.path)
      ])
    ].slice(0, 50),
    summary: `${scan.files.length} source/configuration files; ${edges.length} verified static dependency declarations; ${Math.min(100, packages.length + languageAnalysis.packages.length)} package manifests.`,
    warnings: [
      'Static declarations are not runtime data flows or function calls. Function call resolution is unknown. Unresolved dependencies and language coverage are recorded separately; no missing edges are invented.',
      ...(languageAnalysis.analysis.diagnostics.length
        ? [
            `${languageAnalysis.analysis.diagnostics.length} unresolved or unsupported declarations/configurations. See analysis diagnostics in the JSON export.`
          ]
        : []),
      ...(scan.coverage.partial ? ['Scan limit reached. This is a partial analysis.'] : [])
    ],
    coverage: scan.coverage
  })
}

import path from 'node:path'
import type { ArchitectureNode } from '@shared/intelligence/schema'
import type { ArchitectureAnalysis } from '@shared/intelligence/analysis-schema'
import { hash, sourceLanguage, type Scan } from './scanner'
import { lexDeclarations, type DeclarationToken } from './declaration-lexer'
import {
  discoverLanguageMetadata,
  withinDirectory,
  type LanguagePackage
} from './language-metadata'

export interface LanguageRelationship {
  source: string
  target: string
  line: number
  relation: 'imports' | 'imports-package' | 'declares-module' | 'references-module' | 'depends-on'
  evidence: string[]
}
const nodeId = (file: string) => `n-${hash(file).slice(0, 16)}`
const languageExtensions = { '.py': 'Python', '.go': 'Go', '.java': 'Java', '.rs': 'Rust' } as const
const languageFor = (file: string) =>
  languageExtensions[path.posix.extname(file) as keyof typeof languageExtensions]
const tokenCache = new Map<string, ReturnType<typeof lexDeclarations>>()

export function analyzeLanguageDependencies(scan: Scan): {
  nodes: ArchitectureNode[]
  relationships: LanguageRelationship[]
  analysis: ArchitectureAnalysis
  packages: Array<{ name: string; manifest: string; entrypoints: string[] }>
} {
  const files = new Map(scan.files.map((file) => [file.path, file]))
  const metadata = discoverLanguageMetadata(files)
  const nodes: ArchitectureNode[] = []
  const relationships: LanguageRelationship[] = []
  const analysis: ArchitectureAnalysis = {
    version: 1,
    scannerVersions: {
      javascript: 'typescript-ast',
      vue: 'vue-sfc',
      declarations: '1',
      metadata: '1'
    },
    languages: scan.languages.map((language) => ({
      language,
      files: scan.files.filter((file) => sourceLanguage(file.path) === language).length,
      imports: ['Python', 'Go', 'Java', 'Rust'].includes(language)
        ? 'static-declarations'
        : ['TypeScript', 'JavaScript', 'Vue'].includes(language)
          ? 'ast'
          : 'file-index-only',
      calls: 'unknown',
      resolved: 0,
      unresolved: 0
    })),
    diagnostics: metadata.diagnostics.slice(0, 200),
    diagnosticsTruncated: metadata.diagnostics.length > 200
  }
  const diagnose = (file: string, line: number, code: string, specifier?: string) => {
    const coverage = analysis.languages.find((entry) => entry.language === languageFor(file))
    if (coverage) coverage.unresolved++
    if (analysis.diagnostics.length < 200)
      analysis.diagnostics.push({
        path: file,
        line,
        code,
        ...(specifier ? { specifier: specifier.slice(0, 500) } : {})
      })
    else analysis.diagnosticsTruncated = true
  }
  const tokens = new Map<string, DeclarationToken[]>()
  for (const file of scan.files) {
    const language = languageFor(file.path)
    if (!language) continue
    const key = `${language}:${file.hash}`
    let lexed = tokenCache.get(key)
    if (!lexed) {
      lexed = lexDeclarations(file.text, language)
      if (tokenCache.size >= 256) tokenCache.delete(tokenCache.keys().next().value!)
      tokenCache.set(key, lexed)
    }
    if (!lexed.valid) diagnose(file.path, 1, 'UNSUPPORTED_OR_MALFORMED_SOURCE')
    else tokens.set(file.path, lexed.tokens)
  }
  const owner = (file: string, packages: LanguagePackage[]) =>
    packages
      .filter((pkg) => withinDirectory(pkg.directory, file))
      .sort((a, b) => b.directory.length - a.directory.length)[0]
  const add = (
    file: string,
    target: string | undefined,
    line: number,
    specifier: string,
    relation: LanguageRelationship['relation'] = 'imports',
    evidence: string[] = []
  ) => {
    if (!target) {
      diagnose(file, line, 'UNRESOLVED_DEPENDENCY', specifier)
      return
    }
    if (target === file) return
    if (relationships.length >= 1200) {
      diagnose(file, line, 'GRAPH_EDGE_LIMIT')
      return
    }
    relationships.push({
      source: nodeId(file),
      target: /^n-[a-f0-9]{16}$/.test(target) ? target : nodeId(target),
      line,
      relation,
      evidence
    })
    const coverage = analysis.languages.find((entry) => entry.language === languageFor(file))
    if (coverage) coverage.resolved++
  }
  const unique = (values: string[]) => ([...new Set(values)].length === 1 ? values[0] : undefined)
  const pythonTarget = (candidate: string) =>
    unique([`${candidate}.py`, `${candidate}/__init__.py`].filter((file) => files.has(file)))
  for (const [file, stream] of tokens) {
    if (languageFor(file) !== 'Python') continue
    const pkg = owner(file, metadata.python)
    let statement: DeclarationToken[] = []
    let nesting = 0
    const read = () => {
      const start = statement.findIndex(
        (token) => token.kind === 'word' && ['from', 'import'].includes(token.value)
      )
      if (start < 0) return
      const head = statement[start]
      if (start && statement[start - 1].value !== ':') return
      const values = statement.slice(start + 1)
      const resolve = (specifier: string) => {
        if (!specifier || !/^\.*[\w.]+$/.test(specifier)) return undefined
        if (specifier.startsWith('.')) {
          const dots = specifier.match(/^\.+/)![0].length
          let directory = path.posix.dirname(file)
          for (let level = 1; level < dots; level++) {
            if (!files.has(`${directory}/__init__.py`)) return undefined
            directory = path.posix.dirname(directory)
          }
          const candidate = path.posix.normalize(
            path.posix.join(directory, specifier.slice(dots).replaceAll('.', '/'))
          )
          if (candidate.startsWith('../')) return undefined
          return pythonTarget(candidate)
        }
        const roots = pkg?.sourceRoots ?? ['.']
        return unique(
          roots.flatMap((root) => {
            const target = pythonTarget(path.posix.join(root, specifier.replaceAll('.', '/')))
            return target ? [target] : []
          })
        )
      }
      if (head.value === 'from') {
        const end = values.findIndex((token) => token.value === 'import')
        if (end < 0) {
          diagnose(file, head.line, 'MALFORMED_IMPORT')
          return
        }
        const specifier = values
          .slice(0, end)
          .map((token) => token.value)
          .join('')
        add(file, resolve(specifier), head.line, specifier, 'imports', pkg ? [pkg.manifest] : [])
      } else {
        for (const clause of split(values, ',')) {
          const end = clause.findIndex((token) => token.value === 'as')
          const specifier = (end < 0 ? clause : clause.slice(0, end))
            .map((token) => token.value)
            .join('')
          add(file, resolve(specifier), head.line, specifier, 'imports', pkg ? [pkg.manifest] : [])
        }
      }
    }
    for (const token of stream) {
      if (token.kind === 'punctuation' && token.value === '(') nesting++
      if (token.kind === 'punctuation' && token.value === ')') nesting--
      if ((token.kind === 'newline' && !nesting) || token.value === ';') {
        read()
        statement = []
      } else if (token.kind !== 'newline') statement.push(token)
    }
    read()
  }

  const goPackage = (directory: string, manifest: string): string | undefined => {
    const identity = `go-package:${directory}`
    const id = nodeId(identity)
    if (nodes.some((node) => node.id === id)) return id
    const members = [...tokens.entries()].filter(
      ([file]) =>
        path.posix.dirname(file) === directory && file.endsWith('.go') && !file.endsWith('_test.go')
    )
    const declarations = members.flatMap(([file, stream]) => {
      const index = stream.findIndex((token) => token.value === 'package')
      return index >= 0 && stream[index + 1]?.kind === 'word'
        ? [{ file, name: stream[index + 1].value, line: stream[index].line }]
        : []
    })
    if (!declarations.length || new Set(declarations.map((entry) => entry.name)).size !== 1)
      return undefined
    if (scan.files.length + nodes.length >= 400) return undefined
    const first = declarations[0]
    nodes.push({
      id,
      name: `${directory} (Go package)`,
      type: 'package',
      description: '',
      packageManifest: manifest,
      evidence: 'static-verified',
      sourceReferences: [
        {
          path: first.file,
          startLine: first.line,
          endLine: first.line,
          hash: files.get(first.file)!.hash
        }
      ]
    })
    return id
  }
  for (const [file, stream] of tokens) {
    if (languageFor(file) !== 'Go') continue
    const pkg = owner(file, metadata.go)
    let depth = 0
    for (let index = 0; index < stream.length; index++) {
      if (stream[index].kind === 'punctuation' && stream[index].value === '{') depth++
      if (stream[index].kind === 'punctuation' && stream[index].value === '}') depth--
      if (depth) continue
      if (stream[index].value !== 'import' || stream[index].kind !== 'word') continue
      let end = index + 1
      const block = stream[end]?.value === '('
      const imports: DeclarationToken[] = []
      while (
        end < stream.length &&
        (block
          ? stream[end].value !== ')'
          : stream[end].kind !== 'newline' && stream[end].value !== ';')
      ) {
        if (stream[end].kind === 'string') imports.push(stream[end])
        end++
      }
      for (const declaration of imports) {
        const specifier = declaration.value
        const candidates = metadata.go.flatMap((target) => {
          const own = pkg?.manifest === target.manifest
          const workspace =
            pkg &&
            metadata.goWorkspaces.find(
              (group) => group.members.has(pkg.directory) && group.members.has(target.directory)
            )
          const names = [
            target.name,
            ...[...(pkg?.dependencies ?? [])]
              .filter(([, directory]) => directory === target.directory)
              .map(([name]) => name)
          ]
          const name = names.find((name) => specifier === name || specifier.startsWith(`${name}/`))
          if (!name || (!own && !workspace && pkg?.dependencies.get(name) !== target.directory))
            return []
          const directory = path.posix.join(target.directory, specifier.slice(name.length))
          const resolved = goPackage(directory, target.manifest)
          return resolved
            ? [
                {
                  resolved,
                  evidence: [
                    target.manifest,
                    ...(pkg ? [pkg.manifest] : []),
                    ...(workspace ? [workspace.manifest] : [])
                  ]
                }
              ]
            : []
        })
        const selected = unique(candidates.map((candidate) => candidate.resolved))
        add(
          file,
          selected,
          declaration.line,
          specifier,
          'imports-package',
          selected ? candidates[0].evidence : []
        )
      }
      index = end
    }
  }

  const javaTypes = new Map<string, string[]>()
  for (const [file, stream] of tokens) {
    if (languageFor(file) !== 'Java') continue
    const compact = stream.filter((token) => token.kind !== 'newline')
    const packageIndex = compact.findIndex(
      (token) => token.value === 'package' && token.kind === 'word'
    )
    const terminator = compact.findIndex(
      (token, index) => index > packageIndex && token.value === ';'
    )
    const namespace =
      packageIndex >= 0 && terminator >= 0
        ? compact
            .slice(packageIndex + 1, terminator)
            .map((token) => token.value)
            .join('')
        : ''
    let depth = 0
    for (let index = 0; index < compact.length; index++) {
      const token = compact[index]
      if (
        !depth &&
        token.kind === 'word' &&
        ['class', 'interface', 'enum', 'record'].includes(token.value) &&
        compact[index + 1]?.kind === 'word'
      ) {
        const name = [namespace, compact[index + 1].value].filter(Boolean).join('.')
        javaTypes.set(name, [...(javaTypes.get(name) ?? []), file])
      }
      if (token.kind === 'punctuation' && token.value === '{') depth++
      if (token.kind === 'punctuation' && token.value === '}') depth--
    }
  }
  for (const [file, stream] of tokens) {
    if (languageFor(file) !== 'Java') continue
    const pkg = owner(file, metadata.java)
    const compact = stream.filter((token) => token.kind !== 'newline')
    let depth = 0
    for (let index = 0; index < compact.length; index++) {
      if (compact[index].kind === 'punctuation' && compact[index].value === '{') depth++
      if (compact[index].kind === 'punctuation' && compact[index].value === '}') depth--
      if (depth) continue
      if (compact[index].value !== 'import' || compact[index].kind !== 'word') continue
      const end = compact.findIndex((token, position) => position > index && token.value === ';')
      if (end < 0) {
        diagnose(file, compact[index].line, 'MALFORMED_IMPORT')
        break
      }
      let names = compact.slice(index + 1, end)
      const isStatic = names[0]?.value === 'static'
      if (isStatic) names = names.slice(1)
      const specifier = names.map((token) => token.value).join('')
      const qualified = isStatic ? specifier.replace(/\.[^.]+$/, '') : specifier
      const candidates = (javaTypes.get(qualified) ?? []).filter((target) => {
        const targetPkg = owner(target, metadata.java)
        if (!pkg || !targetPkg) return !pkg && !targetPkg
        return (
          pkg.sourceRoots.some((root) => withinDirectory(root, file)) &&
          targetPkg.sourceRoots.some((root) => withinDirectory(root, target)) &&
          (pkg.manifest === targetPkg.manifest ||
            (!!pkg.workspace &&
              pkg.workspace === targetPkg.workspace &&
              pkg.dependencies.has(targetPkg.name)))
        )
      })
      const resolvedOwner =
        candidates.length === 1 ? owner(candidates[0], metadata.java) : undefined
      add(
        file,
        unique(candidates),
        compact[index].line,
        specifier,
        'imports',
        pkg
          ? [
              pkg.manifest,
              ...(pkg.workspace ? [pkg.workspace] : []),
              ...(resolvedOwner ? [resolvedOwner.manifest] : [])
            ]
          : []
      )
      index = end
    }
  }

  const rustModules = new Map<string, Map<string, string>>()
  const rustRoots = new Set(metadata.rust.flatMap((pkg) => pkg.entrypoints))
  for (const [file, stream] of tokens) {
    if (languageFor(file) !== 'Rust') continue
    const compact = stream.filter((token) => token.kind !== 'newline')
    let depth = 0
    let attributed = false
    for (let index = 0; index < compact.length; index++) {
      const token = compact[index]
      if (!depth && token.value === '#') attributed = true
      if (
        !depth &&
        token.value === 'mod' &&
        token.kind === 'word' &&
        compact[index + 1]?.kind === 'word' &&
        compact[index + 2]?.value === ';'
      ) {
        const name = compact[index + 1].value
        const rootFile =
          path.posix.basename(file) === 'mod.rs' ||
          owner(file, metadata.rust)?.entrypoints.includes(file)
        const directory = rootFile ? path.posix.dirname(file) : file.slice(0, -3)
        const target = attributed
          ? undefined
          : unique(
              [`${directory}/${name}.rs`, `${directory}/${name}/mod.rs`].filter((candidate) =>
                files.has(candidate)
              )
            )
        if (target) {
          if (!rustModules.has(file)) rustModules.set(file, new Map())
          rustModules.get(file)!.set(name, target)
        }
        add(file, target, token.line, name, 'declares-module')
        attributed = false
      }
      if (token.kind === 'punctuation' && ['{', '(', '['].includes(token.value)) depth++
      if (token.kind === 'punctuation' && ['}', ')', ']'].includes(token.value)) {
        depth--
        if (!depth && token.value === '}') attributed = false
      }
      if (!depth && token.kind === 'punctuation' && token.value === ';') attributed = false
    }
  }
  const ambiguousRustContexts = new Set(
    [...rustModules.values()]
      .flatMap((children) => [...children.values()])
      .filter((file) => rustRoots.has(file))
  )
  for (const file of ambiguousRustContexts) {
    rustModules.delete(file)
    diagnose(file, 1, 'AMBIGUOUS_RUST_MODULE_CONTEXT')
  }
  const reachableRustFiles = new Set<string>()
  const visitRust = (file: string) => {
    if (reachableRustFiles.has(file)) return
    reachableRustFiles.add(file)
    for (const target of rustModules.get(file)?.values() ?? []) visitRust(target)
  }
  for (const root of rustRoots) visitRust(root)
  for (let index = relationships.length - 1; index >= 0; index--) {
    const relationship = relationships[index]
    if (relationship.relation !== 'declares-module') continue
    const file = scan.files.find((file) => nodeId(file.path) === relationship.source)!.path
    if (!reachableRustFiles.has(file) || ambiguousRustContexts.has(file)) {
      relationships.splice(index, 1)
      const coverage = analysis.languages.find((entry) => entry.language === 'Rust')
      if (coverage) coverage.resolved--
    }
  }
  for (const [file, stream] of tokens) {
    if (languageFor(file) !== 'Rust') continue
    if (!reachableRustFiles.has(file) || ambiguousRustContexts.has(file)) {
      if (stream.length) diagnose(file, 1, 'RUST_CRATE_ROOT_UNKNOWN')
      continue
    }
    const pkg = owner(file, metadata.rust)
    const compact = stream.filter((token) => token.kind !== 'newline')
    let depth = 0
    for (let index = 0; index < compact.length; index++) {
      if (compact[index].kind === 'punctuation' && ['{', '(', '['].includes(compact[index].value))
        depth++
      if (compact[index].kind === 'punctuation' && ['}', ')', ']'].includes(compact[index].value))
        depth--
      if (depth) continue
      if (compact[index].value !== 'use' || compact[index].kind !== 'word') continue
      const first = compact[index + 1]
      if (!first || first.kind !== 'word') continue
      let candidates: string[]
      if (first.value === 'crate') {
        const reachable = (root: string, seen = new Set<string>()): boolean => {
          if (root === file) return true
          if (seen.has(root)) return false
          seen.add(root)
          return [...(rustModules.get(root)?.values() ?? [])].some((child) =>
            reachable(child, seen)
          )
        }
        candidates = (pkg?.entrypoints ?? []).filter((root) => reachable(root))
      } else if (first.value === 'self') candidates = [file]
      else if (first.value === 'super')
        candidates = [...rustModules]
          .filter(([, children]) => [...children.values()].includes(file))
          .map(([parent]) => parent)
      else {
        const dependency = pkg?.dependencies.get(first.value)
        const manifest = dependency ? path.posix.join(dependency, 'Cargo.toml') : undefined
        add(
          file,
          manifest && files.has(manifest) ? manifest : undefined,
          first.line,
          first.value,
          'depends-on',
          pkg ? [pkg.manifest] : []
        )
        continue
      }
      let position = index + 2
      while (compact[position]?.value === '::' && compact[position + 1]?.kind === 'word') {
        const next = candidates.map((candidate) =>
          rustModules.get(candidate)?.get(compact[position + 1].value)
        )
        if (next.some((target) => !target)) {
          if (next.some(Boolean)) {
            candidates = []
            diagnose(file, first.line, 'AMBIGUOUS_RUST_MODULE_CONTEXT')
          }
          break // The remainder may name a symbol; no call or symbol edge is inferred.
        }
        candidates = next.filter((target): target is string => !!target)
        position += 2
      }
      if (compact[position]?.value === '::')
        diagnose(file, first.line, 'RUST_SYMBOL_RESOLUTION_UNKNOWN')
      add(
        file,
        unique(candidates),
        first.line,
        compact
          .slice(index + 1, position)
          .map((token) => token.value)
          .join(''),
        'references-module',
        pkg ? [pkg.manifest] : []
      )
    }
  }
  return {
    nodes,
    relationships,
    analysis,
    packages: [...metadata.python, ...metadata.go, ...metadata.java, ...metadata.rust]
      .slice(0, 100)
      .map(({ name, manifest, entrypoints }) => ({
        name: name.slice(0, 200),
        manifest,
        entrypoints: entrypoints.slice(0, 20)
      }))
  }
}

function split(tokens: DeclarationToken[], separator: string): DeclarationToken[][] {
  const clauses: DeclarationToken[][] = [[]]
  for (const token of tokens) {
    if (token.value === separator) clauses.push([])
    else clauses.at(-1)!.push(token)
  }
  return clauses.filter((clause) => clause.length)
}

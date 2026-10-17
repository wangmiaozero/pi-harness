import path from 'node:path'
import { parse as parseToml } from 'smol-toml'
import { DOMParser, type Element } from '@xmldom/xmldom'
import type { ScannedFile } from './scanner'
import type { ArchitectureAnalysis } from '@shared/intelligence/analysis-schema'
import { lexDeclarations } from './declaration-lexer'

export type MetadataDiagnostic = ArchitectureAnalysis['diagnostics'][number]
export type LanguagePackage = {
  name: string
  manifest: string
  directory: string
  entrypoints: string[]
  dependencies: Map<string, string>
  sourceRoots: string[]
  workspace?: string
}
export const withinDirectory = (directory: string, file: string): boolean =>
  directory === '.' || file.startsWith(`${directory}/`)
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
const literalPath = (base: string, value: unknown): string | undefined => {
  if (typeof value !== 'string' || /[${}\\*]/.test(value) || path.posix.isAbsolute(value))
    return undefined
  const target = path.posix.normalize(path.posix.join(base, value))
  return target === '..' || target.startsWith('../') ? undefined : target
}

/** Read declarations only. No compiler host, import, package download or build-script evaluation. */
export function discoverLanguageMetadata(files: Map<string, ScannedFile>): {
  python: LanguagePackage[]
  go: LanguagePackage[]
  java: LanguagePackage[]
  rust: LanguagePackage[]
  diagnostics: MetadataDiagnostic[]
  goWorkspaces: Array<{ manifest: string; members: Set<string> }>
} {
  const result = {
    python: [] as LanguagePackage[],
    go: [] as LanguagePackage[],
    java: [] as LanguagePackage[],
    rust: [] as LanguagePackage[],
    diagnostics: [] as MetadataDiagnostic[],
    goWorkspaces: [] as Array<{ manifest: string; members: Set<string> }>
  }
  const tomls = new Map<string, Record<string, unknown>>()
  const javaWorkspaces: Array<{ manifest: string; members: Map<string, string> }> = []
  for (const file of files.values()) {
    if (!/(?:^|\/)(?:Cargo|pyproject)\.toml$/.test(file.path)) continue
    try {
      tomls.set(file.path, parseToml(file.text))
    } catch {
      result.diagnostics.push({ code: 'INVALID_MANIFEST', path: file.path, line: 1 })
    }
  }
  for (const file of files.values()) {
    const directory = path.posix.dirname(file.path)
    const pkg: LanguagePackage = {
      name: directory,
      manifest: file.path,
      directory,
      entrypoints: [],
      dependencies: new Map(),
      sourceRoots: []
    }
    if (path.posix.basename(file.path) === 'pyproject.toml') {
      const data = tomls.get(file.path)
      if (!data) continue
      const project = object(data.project)
      const tool = object(data.tool)
      const poetry = object(tool.poetry)
      pkg.name = String(project.name ?? poetry.name ?? directory)
      const source = object(object(tool.setuptools)['package-dir'])['']
      pkg.sourceRoots = [directory]
      if (source !== undefined) {
        const root = literalPath(directory, source)
        if (root) pkg.sourceRoots = [root]
        else result.diagnostics.push({ code: 'UNSUPPORTED_SOURCE_ROOT', path: file.path, line: 1 })
      }
      if (Array.isArray(poetry.packages))
        for (const entry of poetry.packages) {
          const root = literalPath(directory, object(entry).from)
          if (root && !pkg.sourceRoots.includes(root)) pkg.sourceRoots.push(root)
        }
      result.python.push(pkg)
    }
    if (path.posix.basename(file.path) === 'go.work') {
      const lexed = lexDeclarations(file.text, 'Go')
      if (!lexed.valid)
        result.diagnostics.push({ code: 'INVALID_MANIFEST', path: file.path, line: 1 })
      const members = new Set<string>()
      result.goWorkspaces.push({ manifest: file.path, members })
      let use = false
      let block = false
      let components: string[] = []
      const flush = () => {
        const root = literalPath(directory, components.join(''))
        if (root && components.length) members.add(root)
        components = []
      }
      for (const token of lexed.tokens) {
        if (token.value === 'use') {
          use = true
          continue
        }
        if (!use) continue
        if (token.value === '(') {
          block = true
          continue
        }
        if (token.value === ')') {
          flush()
          use = false
          block = false
          continue
        }
        if (token.kind === 'newline') {
          flush()
          if (!block) use = false
          continue
        }
        components.push(token.value)
      }
      flush()
    }
    if (path.posix.basename(file.path) === 'go.mod') {
      const clean = file.text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
      const moduleName = clean.match(/^\s*module\s+([\w./-]+)\s*$/m)?.[1]
      if (!moduleName) {
        result.diagnostics.push({ code: 'INVALID_MANIFEST', path: file.path, line: 1 })
        continue
      }
      pkg.name = moduleName
      pkg.sourceRoots = [directory]
      for (const match of clean.matchAll(
        /(?:^|\n)\s*(?:replace\s+)?([\w./-]+)(?:\s+v[^\s]+)?\s*=>\s*(\.\.?\/[\w./-]+)\s*$/g
      )) {
        const target = literalPath(directory, match[2])
        if (target) pkg.dependencies.set(match[1], target)
      }
      result.go.push(pkg)
    }
    if (path.posix.basename(file.path) === 'Cargo.toml') {
      const data = tomls.get(file.path)
      if (!data || typeof object(data.package).name !== 'string') continue
      pkg.name = String(object(data.package).name)
      const lib = literalPath(directory, object(data.lib).path ?? 'src/lib.rs')
      const main = literalPath(directory, 'src/main.rs')
      pkg.entrypoints = [lib, main].filter((entry): entry is string => !!entry && files.has(entry))
      for (const section of ['bin', 'test', 'example', 'bench']) {
        const declared = data[section]
        if (Array.isArray(declared))
          for (const entry of declared) {
            const target = literalPath(directory, object(entry).path)
            if (target && files.has(target)) pkg.entrypoints.push(target)
          }
      }
      if (object(data.package).autobins !== false)
        for (const candidate of files.keys()) {
          const relative = path.posix.relative(directory, candidate)
          if (/^src\/bin\/(?:[^/]+\.rs|[^/]+\/main\.rs)$/.test(relative))
            pkg.entrypoints.push(candidate)
        }
      pkg.entrypoints = [...new Set(pkg.entrypoints)]
      const workspace = [...tomls.entries()]
        .filter(
          ([name, value]) => value.workspace && withinDirectory(path.posix.dirname(name), file.path)
        )
        .sort(([a], [b]) => b.length - a.length)[0]
      for (const section of ['dependencies', 'dev-dependencies', 'build-dependencies']) {
        for (const [alias, declaration] of Object.entries(object(data[section]))) {
          let value = object(declaration)
          let base = directory
          if (value.workspace === true && workspace) {
            value = object(object(object(workspace[1].workspace).dependencies)[alias])
            base = path.posix.dirname(workspace[0])
          }
          const target = literalPath(base, value.path)
          const targetPackage = target
            ? object(tomls.get(path.posix.join(target, 'Cargo.toml'))?.package)
            : {}
          if (target && targetPackage.name === (value.package ?? alias))
            pkg.dependencies.set(alias.replaceAll('-', '_'), target)
        }
      }
      pkg.sourceRoots = [path.posix.join(directory, 'src')]
      result.rust.push(pkg)
    }
    if (path.posix.basename(file.path) === 'pom.xml') {
      let invalid = false
      try {
        if (/<!DOCTYPE|<!ENTITY/i.test(file.text)) throw new Error('Unsupported XML declarations')
        const fail = () => {
          invalid = true
        }
        const document = new DOMParser({
          onError: fail
        }).parseFromString(file.text, 'text/xml')
        const project = document.documentElement
        if (!project || project.localName !== 'project' || invalid)
          throw new Error('Invalid Maven manifest')
        const child = (element: Element | null, name: string): Element | null =>
          element
            ? (Array.from(element.childNodes).find(
                (node): node is Element =>
                  node.nodeType === 1 && (node as Element).localName === name
              ) ?? null)
            : null
        const value = (element: Element | null, name: string) =>
          child(element, name)?.textContent?.trim()
        const group = value(project, 'groupId') ?? value(child(project, 'parent'), 'groupId')
        const artifact = value(project, 'artifactId')
        if (!group || !artifact || /\$\{/.test(group + artifact))
          throw new Error('Unresolved Maven identity')
        pkg.name = `${group}:${artifact}`
        const modules = child(project, 'modules')
        if (modules) {
          const members = new Map<string, string>()
          members.set(directory, directory)
          for (const module of Array.from(modules.childNodes).filter(
            (node): node is Element =>
              node.nodeType === 1 && (node as Element).localName === 'module'
          )) {
            const target = literalPath(directory, module.textContent?.trim())
            if (target) members.set(target, target)
          }
          javaWorkspaces.push({ manifest: file.path, members })
        }
        const source = literalPath(
          directory,
          value(child(project, 'build'), 'sourceDirectory') ?? 'src/main/java'
        )
        pkg.sourceRoots = source ? [source] : []
        const dependencies = child(project, 'dependencies')
        if (dependencies)
          for (const dependency of Array.from(dependencies.childNodes).filter(
            (node): node is Element =>
              node.nodeType === 1 && (node as Element).localName === 'dependency'
          )) {
            const depGroup = value(dependency, 'groupId')
            const depArtifact = value(dependency, 'artifactId')
            const scope = value(dependency, 'scope')
            if (depGroup && depArtifact && (!scope || ['compile', 'provided'].includes(scope)))
              pkg.dependencies.set(`${depGroup}:${depArtifact}`, '')
          }
        result.java.push(pkg)
      } catch {
        result.diagnostics.push({ code: 'UNRESOLVED_MANIFEST', path: file.path, line: 1 })
      }
    }
    if (/^build\.gradle(?:\.kts)?$/.test(path.posix.basename(file.path))) {
      pkg.sourceRoots = [path.posix.join(directory, 'src/main/java')]
      const lexed = lexDeclarations(file.text, 'Java')
      if (!lexed.valid) {
        result.diagnostics.push({ code: 'UNRESOLVED_MANIFEST', path: file.path, line: 1 })
        continue
      }
      const tokens = lexed.tokens.filter((token) => token.kind !== 'newline')
      if (
        tokens.some(
          (token) =>
            token.kind === 'word' && ['sourceSets', 'srcDirs', 'srcDir'].includes(token.value)
        )
      )
        pkg.sourceRoots = []
      for (let index = 0; index < tokens.length; index++) {
        if (
          tokens[index].kind !== 'word' ||
          tokens[index].value !== 'dependencies' ||
          tokens[index + 1]?.value !== '{'
        )
          continue
        let depth = 1
        for (let position = index + 2; position < tokens.length && depth; position++) {
          const token = tokens[position]
          if (token.kind === 'punctuation' && token.value === '{') depth++
          if (token.kind === 'punctuation' && token.value === '}') depth--
          if (
            depth !== 1 ||
            token.kind !== 'word' ||
            !['api', 'implementation', 'compileOnly', 'compile'].includes(token.value)
          )
            continue
          let argument = position + 1
          if (tokens[argument]?.value === '(') argument++
          if (
            tokens[argument]?.value !== 'project' ||
            tokens[argument + 1]?.value !== '(' ||
            tokens[argument + 2]?.kind !== 'string' ||
            tokens[argument + 3]?.value !== ')'
          )
            continue
          const relative = tokens[argument + 2].value
          if (/^:[\w-]+(?::[\w-]+)*$/.test(relative)) pkg.dependencies.set(relative, relative)
        }
      }
      result.java.push(pkg)
      result.diagnostics.push({
        code: 'GRADLE_DYNAMIC_CONFIGURATION_UNKNOWN',
        path: file.path,
        line: 1
      })
    }
    if (/^settings\.gradle(?:\.kts)?$/.test(path.posix.basename(file.path))) {
      const lexed = lexDeclarations(file.text, 'Java')
      if (
        !lexed.valid ||
        lexed.tokens.some(
          (token) => token.kind === 'word' && ['projectDir', 'includeBuild'].includes(token.value)
        )
      ) {
        result.diagnostics.push({ code: 'UNRESOLVED_GRADLE_WORKSPACE', path: file.path, line: 1 })
        continue
      }
      const members = new Map<string, string>()
      for (let index = 0; index < lexed.tokens.length; index++) {
        if (lexed.tokens[index].kind !== 'word' || lexed.tokens[index].value !== 'include') continue
        let position = index + 1
        let block = false
        if (lexed.tokens[position]?.value === '(') {
          block = true
          position++
        }
        const names: string[] = []
        let valid = true
        while (
          position < lexed.tokens.length &&
          (block ? lexed.tokens[position].value !== ')' : lexed.tokens[position].kind !== 'newline')
        ) {
          const token = lexed.tokens[position++]
          if (token.kind === 'string' && /^:?[\w-]+(?::[\w-]+)*$/.test(token.value))
            names.push(token.value)
          else if (token.value !== ',' && token.kind !== 'newline') valid = false
        }
        if (!valid) {
          result.diagnostics.push({ code: 'UNRESOLVED_GRADLE_WORKSPACE', path: file.path, line: 1 })
          continue
        }
        for (const name of names) {
          const target = literalPath(directory, name.replace(/^:/, '').replaceAll(':', '/'))
          if (target) members.set(target, name.startsWith(':') ? name : `:${name}`)
        }
      }
      javaWorkspaces.push({ manifest: file.path, members })
    }
  }
  for (const pkg of result.java) {
    const workspace = javaWorkspaces
      .filter((group) => group.members.has(pkg.directory))
      .sort((a, b) => b.manifest.length - a.manifest.length)[0]
    if (workspace) {
      pkg.workspace = workspace.manifest
      if (/settings\.gradle/.test(workspace.manifest))
        pkg.name = workspace.members.get(pkg.directory)!
    }
  }
  return result
}

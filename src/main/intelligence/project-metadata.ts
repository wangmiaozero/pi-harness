import path from 'node:path'
import { parse as parseJsonc, type ParseError } from 'jsonc-parser'
import type { ArchitectureGraph } from '@shared/intelligence/schema'
import type { ScannedFile } from './scanner'

export type LocalPackage = ArchitectureGraph['project']['packages'][number] & {
  directory: string
  exports: Record<string, string>
  dependencies: Record<string, string>
}
const within = (directory: string, file: string): boolean =>
  directory === '.' || file.startsWith(`${directory}/`)

/** Resolve only files already admitted by the scanner; never read through a compiler host. */
export function resolveIndexedFile(
  files: Map<string, ScannedFile>,
  candidate: string
): string | undefined {
  const normalized = path.posix.normalize(candidate)
  if (normalized.startsWith('../') || path.posix.isAbsolute(normalized)) return undefined
  const substituted = /\.(?:js|jsx|mjs|cjs)$/.test(normalized)
    ? [
        normalized.replace(/\.(?:js|jsx|mjs|cjs)$/, '.ts'),
        normalized.replace(/\.(?:js|jsx|mjs|cjs)$/, '.tsx')
      ]
    : []
  return [
    ...substituted,
    normalized,
    ...[
      '.ts',
      '.tsx',
      '.js',
      '.jsx',
      '.vue',
      '.mjs',
      '.cjs',
      '.mts',
      '.cts',
      '/index.ts',
      '/index.tsx',
      '/index.js',
      '/index.mjs',
      '/index.vue'
    ].map((suffix) => normalized + suffix)
  ].find((name) => files.has(name))
}

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  // Conditional exports are not runtime traces. Prefer source/type declarations when present.
  const object = value as Record<string, unknown>
  return ['source', 'types', 'import', 'require', 'default'].flatMap((key) => strings(object[key]))
}

export function discoverPackages(files: Map<string, ScannedFile>): LocalPackage[] {
  const packages: LocalPackage[] = []
  for (const file of files.values()) {
    if (!/(?:^|\/)package\.json$/.test(file.path) || packages.length >= 100) continue
    try {
      const pkg = JSON.parse(file.text)
      if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) continue
      const directory = path.posix.dirname(file.path)
      const resolve = (value: string) => {
        if (!value.startsWith('./') && (value.startsWith('/') || value.includes('..')))
          return undefined
        const target = resolveIndexedFile(files, path.posix.join(directory, value))
        return target && within(directory, target) ? target : undefined
      }
      const exports: Record<string, string> = {}
      const declared = pkg.exports
      const entries: Array<[string, unknown]> =
        declared &&
        typeof declared === 'object' &&
        Object.keys(declared).some((key) => key.startsWith('.'))
          ? Object.entries(declared)
          : [['.', declared]]
      for (const [key, value] of entries.slice(0, 30)) {
        if (key.includes('*')) continue // No invented wildcard export paths.
        const target = strings(value).map(resolve).find(Boolean)
        if (target) exports[key] = target
      }
      const entrypoints = [
        ...new Set([
          ...Object.values(exports),
          ...['source', 'module', 'main', 'types'].flatMap((key) =>
            strings(pkg[key])
              .map(resolve)
              .filter((p): p is string => !!p)
          )
        ])
      ].slice(0, 20)
      if (!exports['.'] && entrypoints[0]) exports['.'] = entrypoints[0]
      packages.push({
        name:
          typeof pkg.name === 'string'
            ? pkg.name.slice(0, 200)
            : directory === '.'
              ? 'root'
              : directory.slice(0, 200),
        manifest: file.path,
        entrypoints,
        directory,
        exports,
        dependencies: Object.fromEntries(
          Object.entries({
            ...pkg.dependencies,
            ...pkg.devDependencies,
            ...pkg.peerDependencies
          }).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        )
      })
    } catch {
      /* malformed/redacted manifest is still indexed as a file */
    }
  }
  return packages
}

type Alias = { pattern: string; targets: string[] }
type ResolvedImport = { target: string; evidence: string[] }
type ResolvedConfig = { aliases: Alias[]; base?: string; evidence: string[] }
/** Read JSONC and local extends from the bounded scan. Never execute a Vite/Webpack config. */
export function dependencyResolver(
  files: Map<string, ScannedFile>,
  packages: LocalPackage[]
): (file: string, spec: string) => ResolvedImport | undefined {
  const configs = [...files.keys()].filter((file) =>
    /(?:^|\/)(?:tsconfig[^/]*|jsconfig)\.json$/.test(file)
  )
  const cache = new Map<string, ResolvedConfig>()
  function config(file: string, seen = new Set<string>()): ResolvedConfig {
    if (cache.has(file)) return cache.get(file)!
    if (seen.has(file) || seen.size >= 8) return { aliases: [], evidence: [] }
    seen.add(file)
    const errors: ParseError[] = []
    const parsed = {
      config: parseJsonc(files.get(file)?.text ?? '', errors, { allowTrailingComma: true }),
      error: errors.length > 0
    }
    if (
      parsed.error ||
      !parsed.config ||
      typeof parsed.config !== 'object' ||
      Array.isArray(parsed.config)
    )
      return { aliases: [], evidence: [] }
    const directory = path.posix.dirname(file)
    let inherited: ResolvedConfig = { aliases: [], evidence: [] }
    if (typeof parsed.config.extends === 'string' && parsed.config.extends.startsWith('.')) {
      const base = path.posix.normalize(path.posix.join(directory, parsed.config.extends))
      const parent = [base, base + '.json'].find((name) => files.has(name))
      if (parent) inherited = config(parent, new Set(seen))
    }
    const options = parsed.config.compilerOptions ?? {}
    const base =
      typeof options.baseUrl === 'string'
        ? path.posix.join(directory, options.baseUrl)
        : inherited.base
    const aliases =
      options.paths && typeof options.paths === 'object' && !Array.isArray(options.paths)
        ? Object.entries(options.paths)
            .slice(0, 100)
            .flatMap(([pattern, values]) =>
              Array.isArray(values) && pattern.split('*').length <= 2
                ? [
                    {
                      pattern,
                      targets: values
                        .filter(
                          (v): v is string =>
                            typeof v === 'string' && v.length <= 500 && v.split('*').length <= 2
                        )
                        .slice(0, 10)
                        .map((v) => path.posix.join(base ?? directory, v))
                    }
                  ]
                : []
            )
        : inherited.aliases
    const result = { aliases, base, evidence: [...new Set([file, ...inherited.evidence])] }
    cache.set(file, result)
    return result
  }
  return (file, spec) => {
    if (spec.startsWith('.')) {
      const target = resolveIndexedFile(files, path.posix.join(path.posix.dirname(file), spec))
      return target ? { target, evidence: [] } : undefined
    }
    if (spec.startsWith('/') || spec.includes('\\') || spec.length > 500) return undefined
    const applicable = configs
      .filter((c) => within(path.posix.dirname(c), file))
      .sort((a, b) => path.posix.dirname(b).length - path.posix.dirname(a).length)
    // The nearest configuration wins; peers (e.g. tsconfig.node/web) must agree.
    const nearest = applicable.length ? path.posix.dirname(applicable[0]) : null
    const resolved = new Map<string, string[]>()
    for (const c of applicable.filter((c) => path.posix.dirname(c) === nearest)) {
      const { aliases, base, evidence } = config(c)
      const matches = aliases
        .filter(({ pattern }) => {
          const [prefix, suffix] = pattern.split('*')
          return suffix === undefined
            ? pattern === spec
            : spec.startsWith(prefix) && spec.endsWith(suffix)
        })
        .sort(
          (a, b) =>
            (a.pattern.includes('*') ? 1 : 0) - (b.pattern.includes('*') ? 1 : 0) ||
            b.pattern.length - a.pattern.length
        )
      for (const alias of matches.slice(0, 1)) {
        const [prefix, suffix] = alias.pattern.split('*')
        const match =
          suffix === undefined ? '' : spec.slice(prefix.length, spec.length - suffix.length)
        const target = alias.targets
          .map((p) => resolveIndexedFile(files, p.replace('*', match)))
          .find(Boolean)
        if (target)
          resolved.set(target, [...new Set([...(resolved.get(target) ?? []), ...evidence])])
      }
      if (!matches.length && base) {
        const target = resolveIndexedFile(files, path.posix.join(base, spec))
        if (target)
          resolved.set(target, [...new Set([...(resolved.get(target) ?? []), ...evidence])])
      }
    }
    if (resolved.size === 1) {
      const [target, evidence] = [...resolved][0]
      return { target, evidence }
    }
    if (resolved.size > 1) return undefined
    const owner = packages
      .filter((pkg) => within(pkg.directory, file))
      .sort((a, b) => b.directory.length - a.directory.length)[0]
    const local = packages.flatMap((pkg) => {
      const subpath =
        spec === pkg.name
          ? '.'
          : spec.startsWith(`${pkg.name}/`)
            ? `./${spec.slice(pkg.name.length + 1)}`
            : ''
      // Do not turn a coincidentally named nested package into a proven dependency.
      const version = owner?.dependencies[pkg.name]
      const linked =
        owner?.manifest === pkg.manifest || (version && /^(?:workspace:|file:|link:)/.test(version))
      return linked && subpath && pkg.exports[subpath]
        ? [
            {
              target: pkg.exports[subpath],
              evidence: [...new Set([pkg.manifest, owner!.manifest])]
            }
          ]
        : []
    })
    return new Set(local.map((item) => item.target)).size === 1 ? local[0] : undefined
  }
}

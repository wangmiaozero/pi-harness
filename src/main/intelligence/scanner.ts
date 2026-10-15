import fs from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import ignore, { type Ignore } from 'ignore'
import { isIgnoredWorkspaceDirectoryName } from '@shared/workspace/search-ignore'
import { relativeSourceSchema, type ArchitectureGraph } from '@shared/intelligence/schema'
import { redact } from '../universal/normalize'
import { SecurityError } from '../services/errors'

export const hash = (s: string | Buffer): string => createHash('sha256').update(s).digest('hex')
export const workspaceId = (root: string): string =>
  hash(process.platform === 'win32' ? root.toLowerCase() : root).slice(0, 32)
const languages: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.mts': 'TypeScript',
  '.cts': 'TypeScript',
  '.vue': 'Vue',
  '.py': 'Python',
  '.java': 'Java',
  '.go': 'Go',
  '.rs': 'Rust',
  '.swift': 'Swift',
  '.c': 'C',
  '.h': 'C',
  '.cpp': 'C++',
  '.hpp': 'C++',
  '.cs': 'C#',
  '.kt': 'Kotlin',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.svelte': 'Svelte'
}
export const sourceLanguage = (file: string): string | undefined => languages[path.extname(file)]
const sensitive =
  /(?:^|\/)(?:\.env(?:\..*)?|\.ssh|\.aws|\.azure|\.gnupg|\.npmrc|\.pypirc|\.netrc|credentials(?:\..*)?|secrets?(?:\..*)?|auth\.json|id_(?:rsa|ed25519)|.*\.(?:pem|key|p12|pfx|sqlite|db))$/i
export type ScannedFile = { path: string; text: string; hash: string; lines: number }
export type Scan = {
  files: ScannedFile[]
  fingerprint: string
  languages: string[]
  frameworks: string[]
  packageManagers: string[]
  coverage: ArchitectureGraph['coverage']
  commit?: string
  branch?: string
}

export async function safeSource(root: string, relative: string): Promise<string> {
  relativeSourceSchema.parse(relative)
  if (sensitive.test(relative)) throw new SecurityError('Sensitive source is excluded.')
  let current = root
  for (const segment of relative.split('/')) {
    current = path.join(current, segment)
    const st = await fs.lstat(current)
    if (st.isSymbolicLink()) throw new SecurityError('Symbolic links are excluded.')
  }
  const real = await fs.realpath(current)
  if (!real.startsWith(root + path.sep)) throw new SecurityError('Source escapes the project.')
  return real
}

/** Bounded handle read with a rechecked canonical path and inode binding. */
export async function readSource(
  root: string,
  relative: string,
  maxBytes = 128_000
): Promise<Buffer> {
  const verified = await safeSource(root, relative)
  const handle = await fs.open(verified, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const st = await handle.stat()
    const current = await fs.stat(await safeSource(root, relative))
    if (
      !st.isFile() ||
      st.size > maxBytes ||
      st.nlink > 1 ||
      st.ino !== current.ino ||
      st.dev !== current.dev
    )
      throw new SecurityError('Source changed during read or exceeds limits.')
    const buffer = Buffer.alloc(maxBytes + 1)
    let offset = 0
    while (offset < buffer.length) {
      const result = await handle.read(buffer, offset, buffer.length - offset, offset)
      if (!result.bytesRead) break
      offset += result.bytesRead
    }
    if (offset > maxBytes) throw new SecurityError('Source exceeds limit.')
    return buffer.subarray(0, offset)
  } finally {
    await handle.close()
  }
}

export async function scanProject(
  root: string,
  signal: AbortSignal,
  excludes: string[] = [],
  progress: (files: number) => void = () => undefined
): Promise<Scan> {
  const result: Scan = {
    files: [],
    fingerprint: '',
    languages: [],
    frameworks: [],
    packageManagers: [],
    coverage: { files: 0, skipped: 0, bytes: 0, partial: false }
  }
  const started = Date.now()
  let visited = 0
  const check = () => {
    signal.throwIfAborted()
    if (
      Date.now() - started > 30_000 ||
      visited >= 6000 ||
      result.files.length >= 400 ||
      result.coverage.bytes > 8_000_000
    ) {
      result.coverage.partial = true
      return false
    }
    return true
  }
  const patterns: Array<{ base: string; rules: Ignore }> = []
  const extra = ignore().add(excludes.map((e) => `${e}/`).concat(excludes))
  async function walk(directory: string, depth: number): Promise<void> {
    if (!check()) return
    if (depth > 20) {
      result.coverage.partial = true
      return
    }
    const base = path.relative(root, directory).split(path.sep).join('/')
    const before = patterns.length
    const gitignore = path.join(directory, '.gitignore')
    try {
      const st = await fs.lstat(gitignore)
      if (st.isFile() && !st.isSymbolicLink() && st.size < 64_000)
        patterns.push({
          base,
          rules: ignore().add(
            (await readSource(root, base ? `${base}/.gitignore` : '.gitignore', 64_000)).toString(
              'utf8'
            )
          )
        })
    } catch {
      /* no local ignore rules */
    }
    let entries
    try {
      entries = (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) =>
        a.name.localeCompare(b.name)
      )
    } catch {
      result.coverage.skipped++
      patterns.length = before
      return
    }
    for (const entry of entries) {
      if (!check()) break
      visited++
      const relative = base ? `${base}/${entry.name}` : entry.name
      const full = path.join(directory, entry.name)
      if (
        !relativeSourceSchema.safeParse(relative).success ||
        entry.isSymbolicLink() ||
        sensitive.test(relative) ||
        isIgnoredWorkspaceDirectoryName(entry.name) ||
        extra.ignores(relative + (entry.isDirectory() ? '/' : '')) ||
        patterns.reduce((ignored, p) => {
          const match = p.rules.test(
            relative.slice(p.base ? p.base.length + 1 : 0) + (entry.isDirectory() ? '/' : '')
          )
          return match.ignored ? true : match.unignored ? false : ignored
        }, false)
      ) {
        result.coverage.skipped++
        continue
      }
      if (entry.isDirectory()) {
        await walk(full, depth + 1)
        continue
      }
      if (!entry.isFile() || !isSource(relative)) {
        result.coverage.skipped++
        continue
      }
      try {
        const content = await readSource(root, relative)
        if (content.includes(0)) {
          result.coverage.skipped++
          continue
        }
        if (result.coverage.bytes + content.length > 8_000_000) {
          result.coverage.partial = true
          break
        }
        const text = content.toString('utf8')
        result.files.push({
          path: relative,
          text: redact(text),
          hash: hash(content),
          lines: text.split(/\r?\n/).length
        })
        result.coverage.bytes += content.length
        progress(result.files.length)
      } catch {
        result.coverage.skipped++
      }
    }
    patterns.length = before
  }
  await walk(root, 0)
  signal.throwIfAborted()
  result.coverage.files = result.files.length
  result.fingerprint = hash(result.files.map((f) => `${f.path}:${f.hash}`).join('\n'))
  result.languages = [
    ...new Set(result.files.map((f) => languages[path.extname(f.path)]).filter(Boolean))
  ]
  const names = result.files.map((f) => f.path)
  result.packageManagers = [
    'pnpm-lock.yaml',
    'package-lock.json',
    'yarn.lock',
    'Cargo.toml',
    'go.mod',
    'go.work',
    'pyproject.toml',
    'pom.xml',
    'build.gradle',
    'Package.swift'
  ].filter((n) => names.some((file) => path.posix.basename(file) === n))
  for (const f of result.files.filter((f) => /(?:^|\/)package.json$/.test(f.path))) {
    try {
      const pkg = JSON.parse(f.text) as {
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
      }
      result.frameworks.push(
        ...Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((k) =>
          /^(vue|react|next|nuxt|electron|express|@nestjs\/core)$/.test(k)
        )
      )
    } catch {
      /* invalid or redacted manifest */
    }
  }
  result.frameworks = [...new Set(result.frameworks)]
  for (const file of result.files) {
    const name = path.posix.basename(file.path)
    if (['pyproject.toml', 'requirements.txt'].includes(name)) {
      for (const framework of ['django', 'fastapi', 'flask'])
        if (new RegExp(`(?:^|[\\s"'])${framework}(?:[\\s"'=<>\\[;]|$)`, 'im').test(file.text))
          result.frameworks.push(framework)
    }
    if (
      ['pom.xml', 'build.gradle', 'build.gradle.kts'].includes(name) &&
      /org\.springframework(?:\.boot)?/.test(file.text)
    )
      result.frameworks.push('Spring')
  }
  result.frameworks = [...new Set(result.frameworks)]
  try {
    const exec = promisify(execFile)
    result.commit = (
      await exec('git', ['-C', root, 'rev-parse', 'HEAD'], {
        timeout: 2000,
        maxBuffer: 2000,
        windowsHide: true
      })
    ).stdout.trim()
    result.branch = (
      await exec('git', ['-C', root, 'branch', '--show-current'], {
        timeout: 2000,
        maxBuffer: 2000,
        windowsHide: true
      })
    ).stdout.trim()
  } catch {
    /* project need not be a Git repository */
  }
  return result
}
function isSource(p: string): boolean {
  return (
    Boolean(languages[path.extname(p)]) ||
    /(?:^|\/)(?:package\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock|Cargo\.toml|go\.(?:mod|work)|pyproject\.toml|requirements\.txt|pom\.xml|(?:build|settings)\.gradle(?:\.kts)?|Package\.swift|README[^/]*\.md|[^/]+\.(?:json|yml|yaml|toml))$/i.test(
      p
    )
  )
}

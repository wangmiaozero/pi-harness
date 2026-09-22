/**
 * Copy Electron desktop services + shared types into the runtime sidecar
 * and rewrite imports for NodeNext (relative .js paths, no @shared alias).
 *
 * Source of truth remains src/main and src/shared. Re-run this script after
 * those files change; then apply the small runtime-only overlays in
 * runtime/src/compat/.
 */
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const runtimeSrc = path.join(repoRoot, 'runtime/src')
const vendorShared = path.join(runtimeSrc, 'vendor/shared')
const desktopRoot = path.join(runtimeSrc, 'desktop')

const SEED_FILES = [
  'services/provider-service.ts',
  'services/model-service.ts',
  'services/metadata-store.ts',
  'services/skills-service.ts',
  'services/diagnostics-service.ts',
  'services/storage.ts',
  'services/errors.ts',
  'services/logger.ts',
  'services/app-paths.ts',
  'pi/config-service.ts',
  'pi/adapter.ts',
  'pi/environment.ts',
  'pi/install-service.ts',
  'pi/node-environment.ts',
  'backup/backup-service.ts',
  'packages/package-manager.ts',
  'packages/package-source.ts',
  'packages/package-inspection.ts',
  'packages/package-permissions.ts',
  'packages/pi-package-registry.ts',
  'skills/builtin-skill-service.ts',
  'skills/builtin-skill-source.ts',
  'capabilities/capability-service.ts',
  'capabilities/skill-registry.ts',
  'capabilities/skill-parser.ts',
  'capabilities/skill-installer.ts',
  'environment/environment-manager.ts',
  'environment/command-resolver.ts',
  'environment/command-runner.ts',
  'environment/path-manager.ts',
  'environment/node-installer.ts',
  'security/secret-store.ts',
  'files/file-access-service.ts',
  'process/pi-process.ts'
]

const BLOCKED_PREFIXES = [
  'sessions/',
  'agent/',
  'harness/',
  'window/',
  'ipc/',
  'git/',
  'workspace/',
  'updater/',
  'files/file-service',
  'files/file-access-writable'
]

function isBlocked(rel) {
  return BLOCKED_PREFIXES.some((prefix) => rel.startsWith(prefix))
}

async function copyShared() {
  await mkdir(vendorShared, { recursive: true })
  await cp(path.join(repoRoot, 'src/shared'), vendorShared, {
    recursive: true,
    filter: (source) => {
      const base = path.basename(source)
      if (base.endsWith('.test.ts') || base.endsWith('.test.js')) return false
      return true
    }
  })
}

async function copySeed() {
  await mkdir(desktopRoot, { recursive: true })
  for (const rel of SEED_FILES) {
    const from = path.join(repoRoot, 'src/main', rel)
    const to = path.join(desktopRoot, rel)
    await mkdir(path.dirname(to), { recursive: true })
    await cp(from, to)
  }
}

function rewriteSpecifier(fromFile, spec) {
  if (spec.startsWith('node:') || spec === 'electron') return spec
  if (!spec.startsWith('.') && !spec.startsWith('@shared/') && spec !== '../../../package.json') {
    return spec
  }

  if (spec.endsWith('package.json') && fromFile.includes(`${path.sep}vendor${path.sep}shared${path.sep}`)) {
    return '../../../../../package.json'
  }

  let target
  if (spec.startsWith('@shared/')) {
    target = path.join(vendorShared, spec.slice('@shared/'.length))
  } else if (spec.startsWith('.')) {
    target = path.resolve(path.dirname(fromFile), spec)
  } else {
    return spec
  }

  // Blocked Electron-only modules become the workspace stub.
  const desktopRel = path.relative(desktopRoot, target).replaceAll('\\', '/')
  if (!desktopRel.startsWith('..') && isBlocked(desktopRel)) {
    const stub = path.join(runtimeSrc, 'compat/workspace-stub')
    let rel = path.relative(path.dirname(fromFile), stub).replaceAll('\\', '/')
    if (!rel.startsWith('.')) rel = `./${rel}`
    return `${rel}.js`
  }

  let rel = path.relative(path.dirname(fromFile), target).replaceAll('\\', '/')
  if (!rel.startsWith('.')) rel = `./${rel}`
  if (rel.endsWith('.js') || rel.endsWith('.json')) return rel
  return `${rel}.js`
}

function rewriteSource(fromFile, source) {
  let next = source.replaceAll(
    /from\s+['"]([^'"]+)['"]/g,
    (_m, spec) => `from '${rewriteSpecifier(fromFile, spec)}'`
  )
  next = next.replaceAll(
    /import\s+['"]([^'"]+)['"]/g,
    (_m, spec) => `import '${rewriteSpecifier(fromFile, spec)}'`
  )
  next = next.replaceAll(
    /from ['"]electron['"]/g,
    () => {
      const stub = path.join(runtimeSrc, 'compat/electron')
      let rel = path.relative(path.dirname(fromFile), stub).replaceAll('\\', '/')
      if (!rel.startsWith('.')) rel = `./${rel}`
      return `from '${rel}.js'`
    }
  )
  return next
}

async function walkTs(dir, out = []) {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) await walkTs(full, out)
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(full)
  }
  return out
}

async function rewriteTree(root) {
  const files = await walkTs(root)
  for (const file of files) {
    const source = await readFile(file, 'utf8')
    const next = rewriteSource(file, source)
    if (next !== source) await writeFile(file, next)
  }
}

await copyShared()
await copySeed()
await rewriteTree(vendorShared)
await rewriteTree(desktopRoot)
console.warn(`ported ${SEED_FILES.length} desktop files + shared vendor`)

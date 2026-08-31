#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDir, '..')
const bundledParent = path.join(projectRoot, 'resources', 'builtin-skills')
const sources = JSON.parse(
  await fs.readFile(path.join(projectRoot, 'src/shared/skills/builtin-sources.json'), 'utf8')
)
const categories = ['engineering', 'productivity', 'misc']

function parseArguments(argv) {
  let source
  let collection
  let check = false
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index]
    if (value === '--check') check = true
    else if (value === '--collection' && argv[index + 1]) collection = argv[++index]
    else if (value === '--source' && argv[index + 1]) source = argv[++index]
    else throw new Error(`Unknown or incomplete option: ${value}`)
  }
  const definition = sources.find((item) => item.directory === (collection || 'mattpocock'))
  if (!definition) throw new Error(`Unknown built-in collection: ${collection}`)
  source ||=
    definition.directory === 'mattpocock'
      ? process.env.MATTPOCOCK_SKILLS_SOURCE?.trim() || path.resolve(projectRoot, '..', 'skills')
      : path.resolve(projectRoot, '..', `${definition.directory}-skills`)
  return { source: path.resolve(source), check, definition, all: !collection }
}

function parseScalar(value) {
  const trimmed = value.trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return trimmed.slice(1, -1)
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1)
  return trimmed
}

function parseSkill(markdown, fallbackName) {
  const lines = markdown.split(/\r?\n/)
  const metadata = new Map()
  if (lines[0]?.trim() === '---') {
    for (let index = 1; index < lines.length; index++) {
      const line = lines[index]
      if (line.trim() === '---') break
      const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/)
      if (match) metadata.set(match[1].toLowerCase(), parseScalar(match[2]))
    }
  }
  return {
    name: metadata.get('name') || fallbackName,
    description: metadata.get('description') || ''
  }
}

async function readEntries(directory) {
  return (await fs.readdir(directory, { withFileTypes: true })).sort((left, right) =>
    left.name.localeCompare(right.name)
  )
}

async function hashDirectory(root) {
  const hash = createHash('sha256')
  const resources = []
  async function visit(current) {
    for (const entry of await readEntries(current)) {
      const absolute = path.join(current, entry.name)
      const relative = path.relative(root, absolute).replace(/\\/g, '/')
      if (!relative || relative.startsWith('../'))
        throw new Error(`Unsafe resource path: ${absolute}`)
      if (entry.isSymbolicLink())
        throw new Error(`Bundled Skills cannot contain symlinks: ${absolute}`)
      if (entry.isDirectory()) {
        await visit(absolute)
        continue
      }
      if (!entry.isFile()) continue
      const data = await fs.readFile(absolute)
      resources.push(relative)
      hash.update(relative)
      hash.update('\0')
      hash.update(normalizeTextLineEndings(data))
      hash.update('\0')
    }
  }
  await visit(root)
  return { hash: hash.digest('hex'), resources }
}

function normalizeTextLineEndings(data) {
  const text = data.toString('utf8')
  if (!text.includes('\r\n') || !Buffer.from(text, 'utf8').equals(data)) return data
  return Buffer.from(text.replace(/\r\n/g, '\n'), 'utf8')
}

async function sourceCommit(source) {
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: source })
  const commit = stdout.trim()
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Source repository commit is invalid')
  return commit
}

async function discoverSkills(source, definition) {
  const skills = []
  const ids = new Set()
  for (const category of definition.layout === 'flat' ? ['engineering'] : categories) {
    const categoryRoot =
      definition.layout === 'flat'
        ? path.join(source, 'skills')
        : path.join(source, 'skills', category)
    for (const entry of await readEntries(categoryRoot)) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue
      if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(entry.name)) {
        throw new Error(`Invalid Skill directory name: ${entry.name}`)
      }
      const skillRoot = path.join(categoryRoot, entry.name)
      const skillFile = path.join(skillRoot, 'SKILL.md')
      let markdown
      try {
        markdown = await fs.readFile(skillFile, 'utf8')
      } catch (error) {
        if (error.code === 'ENOENT') continue
        throw error
      }
      if (ids.has(entry.name)) throw new Error(`Duplicate formal Skill id: ${entry.name}`)
      ids.add(entry.name)
      const parsed = parseSkill(markdown, entry.name)
      const hashed = await hashDirectory(skillRoot)
      skills.push({
        id: entry.name,
        name: parsed.name,
        description: parsed.description,
        category,
        sourcePath: `skills/${category}/${entry.name}`,
        hash: hashed.hash,
        resources: hashed.resources
      })
    }
  }
  return skills
}

async function verifyBundle(root, definition) {
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'))
  if (
    manifest.schemaVersion !== 1 ||
    manifest.id !== definition.id ||
    manifest.repository !== definition.repository ||
    manifest.license !== 'MIT' ||
    !/^[a-f0-9]{40}$/.test(manifest.commit) ||
    !Array.isArray(manifest.skills) ||
    manifest.skills.length === 0
  ) {
    throw new Error(`Bundled ${definition.name} manifest is invalid`)
  }
  await fs.access(path.join(root, 'LICENSE'))
  const ids = new Set()
  for (const skill of manifest.skills) {
    if (ids.has(skill.id)) throw new Error(`Duplicate bundled Skill id: ${skill.id}`)
    ids.add(skill.id)
    if (!categories.includes(skill.category)) throw new Error(`Invalid category: ${skill.category}`)
    if (skill.sourcePath !== `skills/${skill.category}/${skill.id}`) {
      throw new Error(`Invalid sourcePath for ${skill.id}`)
    }
    const skillRoot = path.join(root, ...skill.sourcePath.split('/'))
    const parsed = parseSkill(await fs.readFile(path.join(skillRoot, 'SKILL.md'), 'utf8'), skill.id)
    const hashed = await hashDirectory(skillRoot)
    if (
      parsed.name !== skill.name ||
      parsed.description !== skill.description ||
      hashed.hash !== skill.hash ||
      JSON.stringify(hashed.resources) !== JSON.stringify(skill.resources)
    ) {
      throw new Error(`Bundled Skill integrity check failed: ${skill.id}`)
    }
  }
  return manifest
}

async function sync(source, definition) {
  const destination = path.join(bundledParent, definition.directory)
  const sourceSkills = path.join(source, 'skills')
  const sourceLicense = path.join(source, 'LICENSE')
  await Promise.all([fs.access(sourceSkills), fs.access(sourceLicense)])
  const [commit, skills] = await Promise.all([
    sourceCommit(source),
    discoverSkills(source, definition)
  ])
  const staging = path.join(bundledParent, `.${definition.directory}.sync-${randomUUID()}`)
  await fs.mkdir(staging, { recursive: true })
  try {
    await fs.copyFile(sourceLicense, path.join(staging, 'LICENSE'))
    for (const skill of skills) {
      const sourcePath =
        definition.layout === 'flat'
          ? path.join(source, 'skills', skill.id)
          : path.join(source, ...skill.sourcePath.split('/'))
      const targetPath = path.join(staging, ...skill.sourcePath.split('/'))
      await fs.cp(sourcePath, targetPath, { recursive: true, errorOnExist: true })
    }
    const manifest = {
      schemaVersion: 1,
      id: definition.id,
      name: definition.name,
      displayName: definition.displayName,
      author: definition.author,
      repository: definition.repository,
      license: 'MIT',
      commit,
      syncedAt: new Date().toISOString(),
      skills
    }
    await fs.writeFile(
      path.join(staging, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`
    )
    await verifyBundle(staging, definition)
    await fs.rm(destination, { recursive: true, force: true })
    await fs.rename(staging, destination)
    return manifest
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  for (const definition of options.check && options.all ? sources : [options.definition]) {
    const manifest = options.check
      ? await verifyBundle(path.join(bundledParent, definition.directory), definition)
      : await sync(options.source, definition)
    process.stdout.write(
      `${options.check ? 'Verified' : 'Synced'} ${manifest.skills.length} ${definition.name} at ${manifest.commit}\n`
    )
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})

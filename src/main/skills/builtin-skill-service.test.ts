import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { AppSettings } from '@shared/ipc/api-types'
import { JsonStore } from '../services/storage'
import type { AppMetadata } from '../services/metadata-store'
import { piEnvironment } from '../pi/environment'
import {
  BuiltinSkillService,
  hashSkillDirectory,
  scanBuiltinSkillSource
} from './builtin-skill-service'

const COMMIT_A = 'a'.repeat(40)
const COMMIT_B = 'b'.repeat(40)

describe('bundled Matt Pocock source', () => {
  it('scans all formal categories and preserves complete Skill resources', async () => {
    const source = await scanBuiltinSkillSource(
      path.resolve('resources/builtin-skills/mattpocock'),
      'builtin:mattpocock-skills'
    )

    expect(source.skills).toHaveLength(29)
    expect(new Set(source.skills.map((skill) => skill.category))).toEqual(
      new Set(['engineering', 'productivity', 'misc'])
    )
    expect(source.skills.some((skill) => skill.sourcePath.includes('deprecated'))).toBe(false)
    expect(source.skills.some((skill) => skill.sourcePath.includes('in-progress'))).toBe(false)
    expect(source.skills.find((skill) => skill.id === 'tdd')).toMatchObject({
      name: 'tdd',
      category: 'engineering',
      bundledHealthy: true,
      resources: expect.arrayContaining(['SKILL.md', 'tests.md', 'mocking.md'])
    })
  })

  it('uses the same content hash for LF and CRLF text checkouts', async () => {
    const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-harness-skill-hash-'))
    const lfRoot = path.join(sandbox, 'lf')
    const crlfRoot = path.join(sandbox, 'crlf')
    await Promise.all([fs.mkdir(lfRoot), fs.mkdir(crlfRoot)])
    await Promise.all([
      fs.writeFile(path.join(lfRoot, 'SKILL.md'), '---\nname: example\n---\n'),
      fs.writeFile(path.join(crlfRoot, 'SKILL.md'), '---\r\nname: example\r\n---\r\n')
    ])

    try {
      await expect(hashSkillDirectory(lfRoot)).resolves.toEqual(await hashSkillDirectory(crlfRoot))
    } finally {
      await fs.rm(sandbox, { recursive: true, force: true })
    }
  })

  it('does not normalize binary resource bytes', async () => {
    const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-harness-skill-hash-'))
    const leftRoot = path.join(sandbox, 'left')
    const rightRoot = path.join(sandbox, 'right')
    await Promise.all([fs.mkdir(leftRoot), fs.mkdir(rightRoot)])
    await Promise.all([
      fs.writeFile(path.join(leftRoot, 'asset.bin'), Buffer.from([0xff, 0x0d, 0x0a, 0xfe])),
      fs.writeFile(path.join(rightRoot, 'asset.bin'), Buffer.from([0xff, 0x0a, 0xfe]))
    ])

    try {
      expect((await hashSkillDirectory(leftRoot)).hash).not.toBe(
        (await hashSkillDirectory(rightRoot)).hash
      )
    } finally {
      await fs.rm(sandbox, { recursive: true, force: true })
    }
  })
})

describe('BuiltinSkillService lifecycle', () => {
  let sandbox = ''
  let sourceParent = ''
  let collectionRoot = ''
  let globalConfig = ''
  let projectRoot = ''
  let backupRoot = ''
  let metadata: JsonStore<AppMetadata>
  let settings: JsonStore<AppSettings>
  let service: BuiltinSkillService

  beforeEach(async () => {
    sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-harness-builtin-skills-'))
    sourceParent = path.join(sandbox, 'bundled')
    collectionRoot = path.join(sourceParent, 'mattpocock')
    globalConfig = path.join(sandbox, 'agent')
    projectRoot = path.join(sandbox, 'project')
    backupRoot = path.join(sandbox, 'backups')
    await Promise.all([
      fs.mkdir(globalConfig, { recursive: true }),
      fs.mkdir(projectRoot, { recursive: true })
    ])
    await writeBundle(collectionRoot, COMMIT_A, [
      {
        id: 'tdd',
        category: 'engineering',
        description: 'Test-driven development',
        files: { 'tests.md': 'tests', 'mocking.md': 'mocking' }
      },
      {
        id: 'teach',
        category: 'productivity',
        description: 'Teach a concept',
        files: { 'templates/lesson.md': 'lesson' }
      }
    ])
    metadata = new JsonStore<AppMetadata>(path.join(sandbox, 'metadata.json'), {
      providers: {},
      models: {},
      capabilities: {},
      builtinSkills: { schemaVersion: 1, installed: {} }
    })
    settings = new JsonStore<AppSettings>(path.join(sandbox, 'settings.json'), {
      manualCliPath: null,
      manualConfigDir: globalConfig
    } as AppSettings)
    await Promise.all([metadata.read(), settings.read()])
    vi.spyOn(piEnvironment, 'detect').mockResolvedValue({
      configDir: globalConfig,
      skillsDirs: [path.join(globalConfig, 'skills')]
    } as never)
    service = createService()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(sandbox, { recursive: true, force: true })
  })

  function createService(): BuiltinSkillService {
    return new BuiltinSkillService(
      settings,
      metadata,
      { assertAllowed: vi.fn(async (target: string) => target) } as never,
      {
        sourceRoot: () => sourceParent,
        backupRoot: () => backupRoot,
        now: () => new Date('2026-08-24T00:00:00.000Z'),
        uuid: () => 'test-id'
      }
    )
  }

  it('atomically installs the complete Skill directory and records exact ownership', async () => {
    const [result] = await service.install(target(['tdd']))
    const installed = path.join(globalConfig, 'skills', 'tdd')

    expect(result).toMatchObject({ ok: true, action: 'install', installedPath: installed })
    await expect(fs.readFile(path.join(installed, 'tests.md'), 'utf8')).resolves.toBe('tests')
    await expect(fs.readFile(path.join(installed, 'mocking.md'), 'utf8')).resolves.toBe('mocking')
    expect(Object.values(metadata.peek().builtinSkills.installed)).toEqual([
      expect.objectContaining({
        collectionId: 'builtin:mattpocock-skills',
        skillId: 'tdd',
        installedPath: installed,
        sourceCommit: COMMIT_A
      })
    ])
    expect(
      (await service.list())[0]?.skills.find((skill) => skill.id === 'tdd')?.installations[0]
    ).toMatchObject({ installed: true, owned: true, health: 'healthy' })
  })

  it('uninstalls only the owned instance, retains the bundle, and supports reinstall', async () => {
    await service.install(target(['tdd']))
    const [removed] = await service.uninstall(target(['tdd']))

    expect(removed).toMatchObject({ ok: true, action: 'uninstall' })
    await expect(fs.stat(path.join(globalConfig, 'skills', 'tdd'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
    await expect(
      fs.readFile(path.join(collectionRoot, 'skills', 'engineering', 'tdd', 'SKILL.md'))
    ).resolves.toBeInstanceOf(Buffer)
    expect(
      (await service.list())[0]?.skills.find((skill) => skill.id === 'tdd')?.installations[0]
    ).toMatchObject({ installed: false, owned: false, health: 'not-installed' })

    await expect(service.install(target(['tdd']))).resolves.toEqual([
      expect.objectContaining({ ok: true, action: 'install' })
    ])
  })

  it('batch uninstall removes only collection-owned Skills', async () => {
    const foreign = path.join(globalConfig, 'skills', 'foreign-skill')
    await fs.mkdir(foreign, { recursive: true })
    await fs.writeFile(path.join(foreign, 'SKILL.md'), '# Foreign')
    await service.install(target(['tdd', 'teach']))

    const results = await service.uninstall(target(['tdd', 'teach']))

    expect(results).toHaveLength(2)
    expect(results.every((result) => result.ok)).toBe(true)
    await expect(fs.readFile(path.join(foreign, 'SKILL.md'), 'utf8')).resolves.toBe('# Foreign')
  })

  it('reports an unowned same-name Skill as conflict and never overwrites silently', async () => {
    const existing = path.join(globalConfig, 'skills', 'tdd')
    await fs.mkdir(existing, { recursive: true })
    await fs.writeFile(path.join(existing, 'SKILL.md'), '# User TDD')

    expect(
      (await service.list())[0]?.skills.find((skill) => skill.id === 'tdd')?.installations[0]
    ).toMatchObject({ owned: false, health: 'conflict' })
    await expect(service.install(target(['tdd']))).resolves.toEqual([
      expect.objectContaining({ ok: false, errorCode: 'SKILL_CONFLICT' })
    ])
    await expect(fs.readFile(path.join(existing, 'SKILL.md'), 'utf8')).resolves.toBe('# User TDD')

    await expect(service.install({ ...target(['tdd']), overwrite: true })).resolves.toEqual([
      expect.objectContaining({ ok: true })
    ])
    await expect(fs.readdir(backupRoot)).resolves.toHaveLength(1)
  })

  it('detects local modifications and a newer bundled commit without silent replacement', async () => {
    await service.install(target(['tdd']))
    const installedSkill = path.join(globalConfig, 'skills', 'tdd', 'SKILL.md')
    await fs.appendFile(installedSkill, '\nLocal modification')

    expect(
      (await service.list())[0]?.skills.find((skill) => skill.id === 'tdd')?.installations[0]
    ).toMatchObject({ modified: true, health: 'modified' })
    await expect(service.install(target(['tdd']))).resolves.toEqual([
      expect.objectContaining({ ok: false, errorCode: 'SKILL_CONFLICT' })
    ])

    await fs.rm(path.join(globalConfig, 'skills', 'tdd'), { recursive: true })
    await service.update({ ...target(['tdd']), overwrite: true })
    await writeBundle(collectionRoot, COMMIT_B, [
      {
        id: 'tdd',
        category: 'engineering',
        description: 'Updated TDD',
        files: { 'tests.md': 'updated', 'mocking.md': 'mocking' }
      },
      {
        id: 'teach',
        category: 'productivity',
        description: 'Teach a concept',
        files: { 'templates/lesson.md': 'lesson' }
      }
    ])

    expect(
      (await service.list())[0]?.skills.find((skill) => skill.id === 'tdd')?.installations[0]
    ).toMatchObject({ modified: false, updateAvailable: true, health: 'update-available' })
  })

  it('removes stale ownership and remains uninstalled after service restart', async () => {
    await service.install(target(['tdd']))
    await fs.rm(path.join(globalConfig, 'skills', 'tdd'), { recursive: true })
    expect(
      (await service.list())[0]?.skills.find((skill) => skill.id === 'tdd')?.installations[0]
    ).toMatchObject({ owned: true, installed: false, health: 'missing' })

    await service.uninstall(target(['tdd']))
    service = createService()

    expect(
      (await service.list())[0]?.skills.find((skill) => skill.id === 'tdd')?.installations[0]
    ).toMatchObject({ owned: false, installed: false, health: 'not-installed' })
  })

  it('installs project-scoped Skills only under the current project', async () => {
    const [result] = await service.install({
      ...target(['teach']),
      scope: 'project',
      projectRoot
    })

    expect(result).toMatchObject({ ok: true, scope: 'project' })
    await expect(
      fs.readFile(path.join(projectRoot, '.pi', 'skills', 'teach', 'SKILL.md'))
    ).resolves.toBeInstanceOf(Buffer)
    await expect(fs.stat(path.join(globalConfig, 'skills', 'teach'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  function target(skillIds: string[]) {
    return {
      collectionId: 'builtin:mattpocock-skills',
      skillIds,
      scope: 'global' as const,
      projectRoot: null
    }
  }
})

async function writeBundle(
  root: string,
  commit: string,
  definitions: Array<{
    id: string
    category: 'engineering' | 'productivity' | 'misc'
    description: string
    files: Record<string, string>
  }>
): Promise<void> {
  await fs.rm(root, { recursive: true, force: true })
  await fs.mkdir(root, { recursive: true })
  await fs.writeFile(path.join(root, 'LICENSE'), 'MIT License\nCopyright (c) 2026 Matt Pocock\n')
  const skills = []
  for (const definition of definitions) {
    const skillRoot = path.join(root, 'skills', definition.category, definition.id)
    await fs.mkdir(skillRoot, { recursive: true })
    await fs.writeFile(
      path.join(skillRoot, 'SKILL.md'),
      `---\nname: ${definition.id}\ndescription: ${definition.description}\n---\n\n# ${definition.id}\n`
    )
    for (const [relative, content] of Object.entries(definition.files)) {
      const target = path.join(skillRoot, relative)
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, content)
    }
    const hashed = await hashSkillDirectory(skillRoot)
    skills.push({
      id: definition.id,
      name: definition.id,
      description: definition.description,
      category: definition.category,
      sourcePath: `skills/${definition.category}/${definition.id}`,
      hash: hashed.hash,
      resources: hashed.resources
    })
  }
  await fs.writeFile(
    path.join(root, 'manifest.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        id: 'builtin:mattpocock-skills',
        name: 'Matt Pocock Skills',
        displayName: 'Skills For Real Engineers',
        author: 'Matt Pocock',
        repository: 'mattpocock/skills',
        license: 'MIT',
        commit,
        syncedAt: '2026-08-24T00:00:00.000Z',
        skills
      },
      null,
      2
    )
  )
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { AppSettings } from '@shared/ipc/api-types'
import { JsonStore } from '../services/storage'
import type { AppMetadata } from '../services/metadata-store'
import { piEnvironment } from '../pi/environment'
import { buildBuiltinSkillBundles, BUILTIN_SKILL_BUNDLES } from '@shared/skills/builtin-bundles'
import {
  BuiltinSkillService,
  hashSkillDirectory,
  scanBuiltinSkillSource
} from './builtin-skill-service'

const COMMIT_A = 'a'.repeat(40)
const COMMIT_B = 'b'.repeat(40)

describe('bundled Matt Pocock source', () => {
  it('bundles all Emil Kowalski skills, references, and the upstream license', async () => {
    const root = path.resolve('resources/builtin-skills/emilkowalski')
    const source = await scanBuiltinSkillSource(root, 'builtin:emilkowalski-skills')
    expect(source.skills).toHaveLength(12)
    expect(source.skills.every((skill) => skill.bundledHealthy)).toBe(true)
    expect(source.skills.find((skill) => skill.id === 'animate')?.resources).toContain('RECIPES.md')
    expect(source.skills.find((skill) => skill.id === 'prototype')?.resources).toContain(
      'PICKER.md'
    )
    expect(await fs.readFile(path.join(root, 'LICENSE'), 'utf8')).toContain(
      'Copyright (c) 2026 Emil Kowalski'
    )
  })
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
    await writeBundle(
      path.join(sourceParent, 'emilkowalski'),
      COMMIT_B,
      [
        {
          id: 'emil-design-eng',
          category: 'engineering',
          description: 'Design engineering',
          files: {}
        },
        {
          id: 'tdd',
          category: 'engineering',
          description: 'Different source fixture',
          files: { 'different.md': 'other source' }
        }
      ],
      'builtin:emilkowalski-skills'
    )
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

  function createService(bundledRoot = sourceParent): BuiltinSkillService {
    return new BuiltinSkillService(
      settings,
      metadata,
      { assertAllowed: vi.fn(async (target: string) => target) } as never,
      {
        sourceRoot: () => bundledRoot,
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

  it('builds four complete role suites without cloning canonical skills or installation state', async () => {
    const sources = await createService(path.resolve('resources/builtin-skills')).list()
    const suites = buildBuiltinSkillBundles(sources)
    expect(suites.map((suite) => suite.skills.length)).toEqual([6, 7, 7, 6])
    expect(new Set(suites.map((suite) => suite.role)).size).toBe(4)
    for (const suite of suites) {
      expect(new Set(suite.skills.map((skill) => skill.id)).size).toBe(suite.skills.length)
      for (const skill of suite.skills) {
        expect(skill).toBe(
          sources
            .find((source) => source.id === skill.collectionId)
            ?.skills.find((entry) => entry.id === skill.id)
        )
      }
    }
    expect(new Set(BUILTIN_SKILL_BUNDLES.map((bundle) => bundle.id)).size).toBe(4)
  })

  it('installs a mixed-source role suite and shares ownership with other suites', async () => {
    const suiteTarget = {
      ...target(['tdd', 'emil-design-eng']),
      collectionId: 'builtin:frontend-engineer'
    }
    const installed = await service.install(suiteTarget)
    expect(installed.every((result) => result.ok)).toBe(true)
    expect(
      Object.values(metadata.peek().builtinSkills.installed)
        .map((record) => record.collectionId)
        .sort()
    ).toEqual(['builtin:emilkowalski-skills', 'builtin:mattpocock-skills'])

    const [shared] = await service.install({
      ...target(['tdd']),
      collectionId: 'builtin:backend-engineer'
    })
    expect(shared).toMatchObject({ ok: true, skipped: true })
    expect(Object.values(metadata.peek().builtinSkills.installed)).toHaveLength(2)
    const removed = await service.uninstall(suiteTarget)
    expect(removed.every((result) => result.ok)).toBe(true)
    expect(Object.values(metadata.peek().builtinSkills.installed)).toHaveLength(0)
    expect(
      (await service.list())[0].skills.find((skill) => skill.id === 'tdd')?.installations[0].health
    ).toBe('not-installed')
  })

  it('rejects skills outside the trusted role suite', async () => {
    expect(
      await service.install({ ...target(['teach']), collectionId: 'builtin:frontend-engineer' })
    ).toEqual([expect.objectContaining({ ok: false, errorCode: 'SKILL_NOT_FOUND' })])
    expect(Object.values(metadata.peek().builtinSkills.installed)).toHaveLength(0)
  })

  it('transfers same-name ownership only after confirmation and prevents stale-source uninstall', async () => {
    await service.install(target(['tdd']))
    const otherTarget = { ...target(['tdd']), collectionId: 'builtin:emilkowalski-skills' }
    expect(await service.install(otherTarget)).toEqual([
      expect.objectContaining({ ok: false, errorCode: 'SKILL_CONFLICT' })
    ])
    expect(await service.install({ ...otherTarget, overwrite: true })).toEqual([
      expect.objectContaining({ ok: true })
    ])
    expect(Object.values(metadata.peek().builtinSkills.installed)).toEqual([
      expect.objectContaining({ collectionId: 'builtin:emilkowalski-skills' })
    ])
    expect(await service.uninstall(target(['tdd']))).toEqual([
      expect.objectContaining({ ok: false })
    ])
    expect(
      await fs.readFile(path.join(globalConfig, 'skills', 'tdd', 'different.md'), 'utf8')
    ).toBe('other source')
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

  it('restores the former source and ownership if a cross-source replacement fails', async () => {
    await service.install(target(['tdd']))
    vi.spyOn(metadata, 'update').mockRejectedValueOnce(new Error('fixture write failure'))
    expect(
      await service.install({
        ...target(['tdd']),
        collectionId: 'builtin:emilkowalski-skills',
        overwrite: true
      })
    ).toEqual([expect.objectContaining({ ok: false })])
    expect(await fs.readFile(path.join(globalConfig, 'skills', 'tdd', 'tests.md'), 'utf8')).toBe(
      'tests'
    )
    expect(Object.values(metadata.peek().builtinSkills.installed)).toEqual([
      expect.objectContaining({ collectionId: 'builtin:mattpocock-skills' })
    ])
    expect(await service.uninstall(target(['tdd']))).toEqual([
      expect.objectContaining({ ok: true })
    ])
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
  }>,
  collectionId = 'builtin:mattpocock-skills'
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
        id: collectionId,
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

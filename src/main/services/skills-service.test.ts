import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const appPathsMock = vi.hoisted(() => ({ backupDir: '' }))

vi.mock('./app-paths', () => ({
  capabilityBackupDir: () => appPathsMock.backupDir,
  getPiConfigDir: () => ''
}))

import { piEnvironment } from '../pi/environment'
import { log } from './logger'
import {
  SKILL_MARKET_CATALOG,
  SkillsService,
  packageNameFromSource,
  resolveInstalledPackagePath
} from './skills-service'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Skills marketplace catalog', () => {
  it('uses stable product entries instead of reference-document titles', () => {
    expect(SKILL_MARKET_CATALOG.map((entry) => entry.id)).toEqual([
      'core-development',
      'agent-architecture',
      'curated-extensions'
    ])
  })

  it('contains unique install sources and no duplicate Git alternative', () => {
    for (const entry of SKILL_MARKET_CATALOG) {
      expect(new Set(entry.sources).size).toBe(entry.sources.length)
      expect(entry.sources.every((source) => source.startsWith('npm:'))).toBe(true)
    }
    expect(SKILL_MARKET_CATALOG[0].sources).toHaveLength(7)
    expect(SKILL_MARKET_CATALOG[1].sources).toHaveLength(13)
    expect(SKILL_MARKET_CATALOG[2].sources).toHaveLength(21)
    expect(SKILL_MARKET_CATALOG[2].sources).toEqual(
      expect.arrayContaining([
        'npm:pi-agent-mode',
        'npm:pi-crew',
        'npm:@baochunli/pi-collaborating-agents',
        'npm:pi-sub-agent',
        'npm:pi-mcp-extension',
        'npm:pi-lmstudio',
        'npm:@langchain/langsmith-pi-extension'
      ])
    )
  })
})

describe('Pi package source paths', () => {
  it('handles scoped and versioned npm package sources', () => {
    expect(packageNameFromSource('npm:@scope/pi-tool@1.2.3')).toBe('@scope/pi-tool')
    expect(packageNameFromSource('npm:pi-tool@1.2.3')).toBe('pi-tool')
    expect(resolveInstalledPackagePath('/agent', 'npm:@scope/pi-tool@1.2.3')).toBe(
      path.join('/agent', 'npm', 'node_modules', '@scope/pi-tool')
    )
  })
})

describe('SkillsService path boundaries', () => {
  let sandbox = ''
  let skillRoot = ''

  beforeEach(async () => {
    sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-harness-skills-service-test-'))
    skillRoot = path.join(sandbox, 'skills')
    appPathsMock.backupDir = path.join(sandbox, 'backups')
    await fs.mkdir(skillRoot, { recursive: true })
    vi.spyOn(piEnvironment, 'detect').mockResolvedValue({
      configDir: null,
      skillsDirs: [skillRoot]
    } as never)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(sandbox, { recursive: true, force: true })
  })

  function service(): SkillsService {
    return new SkillsService({
      peek: () => ({ manualCliPath: null, manualConfigDir: null })
    } as never)
  }

  it('reads only skill markdown files whose real path remains in trusted roots', async () => {
    const skillDir = path.join(skillRoot, 'safe-skill')
    const outside = path.join(sandbox, 'outside')
    await fs.mkdir(skillDir)
    await fs.mkdir(outside)
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), '# Safe')
    await fs.writeFile(path.join(outside, 'SKILL.md'), '# Outside')
    await fs.symlink(outside, path.join(skillRoot, 'escaped'))

    await expect(service().read(path.join(skillDir, 'SKILL.md'))).resolves.toMatchObject({
      content: '# Safe'
    })
    await expect(service().read(path.join(outside, 'SKILL.md'))).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    })
    await expect(service().read(path.join(skillRoot, 'escaped', 'SKILL.md'))).rejects.toMatchObject(
      {
        code: 'VALIDATION_ERROR'
      }
    )
    await expect(service().read(path.join(skillDir, 'secrets.txt'))).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    })
    await expect(service().list()).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'escaped' })])
    )
  })

  it('treats an optional skill root that does not exist as empty', async () => {
    await fs.rm(skillRoot, { recursive: true, force: true })
    const debug = vi.spyOn(log.pi, 'debug')

    await expect(service().list()).resolves.toEqual([])
    expect(debug).not.toHaveBeenCalled()
  })

  it('backs up direct child directories and never deletes a root or symlink target', async () => {
    const skillDir = path.join(skillRoot, 'safe-skill')
    const outside = path.join(sandbox, 'outside')
    const linkedSkill = path.join(skillRoot, 'linked-skill')
    await fs.mkdir(skillDir)
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), '# Safe')
    await fs.mkdir(outside)
    await fs.writeFile(path.join(outside, 'keep.txt'), 'keep')
    await fs.symlink(outside, linkedSkill)

    await expect(service().delete(skillRoot)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    await expect(fs.stat(skillRoot)).resolves.toBeDefined()

    await service().delete(skillDir)
    await expect(fs.stat(skillDir)).rejects.toMatchObject({ code: 'ENOENT' })
    const backups = await fs.readdir(appPathsMock.backupDir)
    expect(backups).toHaveLength(1)
    await expect(
      fs.readFile(path.join(appPathsMock.backupDir, backups[0]!, 'SKILL.md'), 'utf8')
    ).resolves.toBe('# Safe')

    await service().delete(linkedSkill)
    await expect(fs.lstat(linkedSkill)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.readFile(path.join(outside, 'keep.txt'), 'utf8')).resolves.toBe('keep')
  })

  it('stores import-replace backups outside skill discovery roots', async () => {
    const existing = path.join(skillRoot, 'replace-me')
    const source = path.join(sandbox, 'source-skill')
    await fs.mkdir(existing)
    await fs.mkdir(source)
    await fs.writeFile(path.join(existing, 'SKILL.md'), '# Original')
    await fs.writeFile(path.join(source, 'SKILL.md'), '# Replacement')

    await service().import({
      source,
      name: 'replace-me',
      targetRoot: skillRoot,
      onConflict: 'replace'
    })

    await expect(fs.readFile(path.join(existing, 'SKILL.md'), 'utf8')).resolves.toBe(
      '# Replacement'
    )
    const backups = await fs.readdir(appPathsMock.backupDir)
    expect(backups).toHaveLength(1)
    expect(path.dirname(path.join(appPathsMock.backupDir, backups[0]!))).toBe(
      appPathsMock.backupDir
    )
    await expect(
      fs.readFile(path.join(appPathsMock.backupDir, backups[0]!, 'SKILL.md'), 'utf8')
    ).resolves.toBe('# Original')
    expect((await service().list()).map((skill) => skill.name)).toEqual(['replace-me'])
  })

  it('rejects nested target roots and external symlinks for writes', async () => {
    const outside = path.join(sandbox, 'outside-write')
    const linkedSkill = path.join(skillRoot, 'linked-skill')
    await fs.mkdir(outside)
    await fs.writeFile(path.join(outside, 'SKILL.md'), '# Original outside')
    await fs.symlink(outside, linkedSkill)

    await expect(
      service().create({
        name: 'nested',
        description: 'nested',
        content: '# Nested skill',
        targetRoot: linkedSkill
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    await expect(
      service().update({
        name: 'linked-skill',
        description: 'changed',
        content: '# Changed outside',
        targetRoot: skillRoot
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    await expect(fs.readFile(path.join(outside, 'SKILL.md'), 'utf8')).resolves.toBe(
      '# Original outside'
    )
  })
})

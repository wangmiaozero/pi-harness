import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { CustomSkinService } from './custom-skin-service'

describe('CustomSkinService', () => {
  let sandbox = ''
  let installRoot = ''
  let projectRoot = ''
  let service: CustomSkinService

  beforeEach(async () => {
    sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-harness-custom-skin-'))
    installRoot = path.join(sandbox, 'installed')
    projectRoot = path.join(sandbox, 'project')
    service = new CustomSkinService(installRoot)
    await fs.mkdir(path.join(projectRoot, 'assets'), { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(sandbox, { recursive: true, force: true })
  })

  it('imports a declarative project and returns local assets as data URLs', async () => {
    await fs.writeFile(path.join(projectRoot, 'assets', 'preview.png'), Buffer.from('png'))
    await writeManifest({ assets: { preview: 'assets/preview.png' } })

    const imported = await service.importProject(projectRoot)

    expect(imported).toMatchObject({
      id: 'test-skin',
      name: 'Test Skin',
      appearance: 'dark',
      previewDataUrl: 'data:image/png;base64,cG5n'
    })
    await expect(service.list()).resolves.toEqual([imported])
    await expect(fs.stat(path.join(installRoot, 'test-skin', 'preview.png'))).resolves.toBeDefined()
  })

  it('rejects traversal and symlinks that escape the project', async () => {
    const outside = path.join(sandbox, 'outside.png')
    await fs.writeFile(outside, 'outside')
    await fs.symlink(outside, path.join(projectRoot, 'assets', 'linked.png'))
    await writeManifest({ assets: { preview: 'assets/linked.png' } })

    await expect(service.importProject(projectRoot)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    })

    await writeManifest({ assets: { preview: '../outside.png' } })
    await expect(service.importProject(projectRoot)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    })
  })

  it('creates an AI-ready project outside the app repository', async () => {
    const target = path.join(sandbox, 'new-skin')
    const result = await service.createProject(target)

    expect(result.path).toBe(target)
    await expect(fs.readFile(path.join(target, 'AGENTS.md'), 'utf8')).resolves.toContain(
      'Only modify this skin project'
    )
    await expect(fs.readFile(path.join(target, 'SKIN_BRIEF.md'), 'utf8')).resolves.toContain(
      'Codex'
    )
    await expect(fs.readFile(path.join(target, 'README.md'), 'utf8')).resolves.toContain(
      '一键复制提示词'
    )
    await expect(fs.readFile(path.join(target, 'skin.schema.json'), 'utf8')).resolves.toContain(
      'Pi-Harness Declarative Skin'
    )
    await expect(service.createProject(target)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    })
  })

  async function writeManifest(overrides: Record<string, unknown> = {}): Promise<void> {
    await fs.writeFile(
      path.join(projectRoot, 'pi-harness-skin.json'),
      JSON.stringify({
        $schema: './skin.schema.json',
        schemaVersion: 1,
        id: 'test-skin',
        name: 'Test Skin',
        version: '1.0.0',
        appearance: 'dark',
        tokens: { accent: '#6688cc' },
        ...overrides
      })
    )
  }
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const processMock = vi.hoisted(() => ({ exec: vi.fn(), invalidateCache: vi.fn() }))
const pathsMock = vi.hoisted(() => ({ backupDir: '', configDir: '' }))

vi.mock('../process/pi-process', () => ({ piProcess: processMock }))
vi.mock('../services/app-paths', () => ({
  capabilityBackupDir: () => pathsMock.backupDir,
  getPiConfigDir: () => pathsMock.configDir
}))

import { classifyPackageError, packageId, PiPackageManager } from './package-manager'

describe('PiPackageManager reconciliation and lifecycle', () => {
  let sandbox = ''
  let agentDir = ''
  let projectRoot = ''
  let manager: PiPackageManager

  beforeEach(async () => {
    vi.clearAllMocks()
    sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-harness-packages-'))
    agentDir = path.join(sandbox, 'agent')
    projectRoot = path.join(sandbox, 'project')
    pathsMock.backupDir = path.join(sandbox, 'backups')
    pathsMock.configDir = agentDir
    await Promise.all([fs.mkdir(agentDir, { recursive: true }), fs.mkdir(projectRoot)])
    manager = new PiPackageManager({
      peek: () => ({ manualCliPath: null, manualConfigDir: agentDir })
    } as never)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.chmod(agentDir, 0o700).catch(() => undefined)
    await fs.rm(sandbox, { recursive: true, force: true })
  })

  it('derives a healthy registered npm package and resource ownership', async () => {
    await writeRegistry(agentDir, ['npm:pi-healthy'])
    const packageRoot = await writePackage(agentDir, 'pi-healthy', {
      version: '1.2.3',
      pi: { skills: ['skills/demo/SKILL.md'], extensions: ['extensions/index.ts'] }
    })
    await fs.mkdir(path.join(packageRoot, 'skills', 'demo'), { recursive: true })
    await fs.writeFile(path.join(packageRoot, 'skills', 'demo', 'SKILL.md'), '# Demo')
    await fs.mkdir(path.join(packageRoot, 'extensions'))
    await fs.writeFile(
      path.join(packageRoot, 'extensions', 'index.ts'),
      `pi.registerTool({ name: 'demo-tool', description: 'demo' })`
    )

    const [pkg] = await manager.list()

    expect(pkg).toMatchObject({
      id: 'global:npm:pi-healthy',
      registered: true,
      installed: true,
      healthy: true,
      health: 'healthy',
      version: '1.2.3'
    })
    expect(pkg?.resourceItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'skill', name: 'demo', packageId: pkg.id }),
        expect.objectContaining({ type: 'extension', name: 'index', packageId: pkg.id }),
        expect.objectContaining({ type: 'tool', name: 'demo-tool', packageId: pkg.id })
      ])
    )
  })

  it('does not confuse a registered missing package with an installed package', async () => {
    await writeRegistry(agentDir, ['npm:pi-missing'])

    await expect(manager.list()).resolves.toEqual([
      expect.objectContaining({
        registered: true,
        installed: false,
        healthy: false,
        health: 'missing'
      })
    ])
  })

  it('discovers managed npm package files that are absent from the registry', async () => {
    await writeRegistry(agentDir, [])
    const packageRoot = await writePackage(agentDir, 'pi-orphan', {
      pi: { extensions: ['extensions/index.js'] }
    })
    await fs.mkdir(path.join(packageRoot, 'extensions'))
    await fs.writeFile(path.join(packageRoot, 'extensions', 'index.js'), 'export {}')

    await expect(manager.list()).resolves.toEqual([
      expect.objectContaining({ registered: false, installed: true, health: 'orphaned' })
    ])
  })

  it('classifies an invalid npm manifest as corrupted', async () => {
    await writeRegistry(agentDir, ['npm:pi-corrupt'])
    const root = packagePath(agentDir, 'pi-corrupt')
    await fs.mkdir(path.join(root, 'extensions'), { recursive: true })
    await fs.writeFile(path.join(root, 'package.json'), '{invalid')

    await expect(manager.list()).resolves.toEqual([
      expect.objectContaining({
        health: 'corrupted',
        problems: expect.arrayContaining([expect.objectContaining({ code: 'MANIFEST_INVALID' })])
      })
    ])
  })

  it('reports a missing runtime dependency as corrupted', async () => {
    await writeRegistry(agentDir, ['npm:pi-dependency'])
    await writePackage(agentDir, 'pi-dependency', {
      pi: { extensions: [] },
      dependencies: { 'missing-runtime': '^1.0.0' }
    })

    await expect(manager.list()).resolves.toEqual([
      expect.objectContaining({
        health: 'corrupted',
        problems: expect.arrayContaining([expect.objectContaining({ code: 'DEPENDENCY_MISSING' })])
      })
    ])
  })

  it('applies registry resource filters without changing package ownership', async () => {
    await writeRegistry(agentDir, [{ source: 'npm:pi-filtered', skills: [] }])
    const root = await writePackage(agentDir, 'pi-filtered', {
      pi: { skills: ['skills/demo/SKILL.md'] }
    })
    await fs.mkdir(path.join(root, 'skills', 'demo'), { recursive: true })
    await fs.writeFile(path.join(root, 'skills', 'demo', 'SKILL.md'), '# Demo')

    const [pkg] = await manager.list()

    expect(pkg).toMatchObject({ health: 'healthy', resources: { skills: [] } })
    expect(pkg?.resourceItems).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'skill' })])
    )
  })

  it('models a registered local extension file and its statically declared tools', async () => {
    const extensionPath = path.join(agentDir, 'local-extension.ts')
    await fs.writeFile(extensionPath, `pi.registerTool({ name: 'local-tool' })`)
    await writeRegistry(agentDir, ['./local-extension.ts'])

    const [pkg] = await manager.list()

    expect(pkg).toMatchObject({
      id: packageId('global', './local-extension.ts', agentDir),
      sourceType: 'local',
      health: 'healthy',
      path: extensionPath
    })
    expect(pkg?.resources).toMatchObject({
      extensions: ['local-extension'],
      tools: ['local-tool']
    })
  })

  it('keeps global and project registrations as separate scope identities', async () => {
    await writeRegistry(agentDir, ['npm:pi-scoped'])
    await writePackage(agentDir, 'pi-scoped', { pi: { extensions: [] } })
    const projectPi = path.join(projectRoot, '.pi')
    await writeRegistry(projectPi, ['npm:pi-scoped'])
    await writePackage(projectPi, 'pi-scoped', { pi: { extensions: [] } })

    const packages = await manager.list(projectRoot)

    expect(packages.map((pkg) => pkg.id)).toEqual([
      packageId('global', 'npm:pi-scoped'),
      packageId('project', 'npm:pi-scoped')
    ])
  })

  it('reconciles duplicate registry entries into one corrupted record', async () => {
    await writeRegistry(agentDir, ['npm:pi-duplicate', 'npm:pi-duplicate@1.0.0'])
    await writePackage(agentDir, 'pi-duplicate', { pi: { extensions: [] } })

    const packages = await manager.list()

    expect(packages).toHaveLength(1)
    expect(packages[0]).toMatchObject({
      health: 'corrupted',
      problems: expect.arrayContaining([expect.objectContaining({ code: 'REGISTRY_MISMATCH' })])
    })
  })

  it.runIf(process.platform !== 'win32')(
    'classifies inaccessible package files as permission errors',
    async () => {
      await writeRegistry(agentDir, ['npm:pi-private'])
      const root = await writePackage(agentDir, 'pi-private', { pi: { extensions: [] } })
      await fs.chmod(root, 0o000)

      const [pkg] = await manager.list()
      await fs.chmod(root, 0o700)

      expect(pkg?.health).toBe('permission-error')
      expect(pkg?.problems).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'PERMISSION_ERROR' })])
      )
    }
  )

  it('removes a stale missing registration without requiring the Pi CLI', async () => {
    await writeRegistry(agentDir, ['npm:pi-stale'])
    processMock.exec.mockResolvedValue({
      stdout: '',
      stderr: 'package files missing',
      exitCode: 1,
      signal: null
    })

    const result = await manager.uninstall({ source: 'npm:pi-stale', scope: 'global' })

    expect(result).toMatchObject({ ok: true, action: 'uninstall' })
    expect(processMock.exec).not.toHaveBeenCalled()
    expect(
      JSON.parse(await fs.readFile(path.join(agentDir, 'settings.json'), 'utf8')).packages
    ).toEqual([])
  })

  it('restores a stale registration when post-uninstall verification fails', async () => {
    await writeRegistry(agentDir, ['npm:pi-stale-rollback'])
    const [before] = await manager.list()
    vi.spyOn(manager, 'list').mockResolvedValueOnce([before!]).mockResolvedValueOnce([before!])

    const result = await manager.uninstall({
      source: 'npm:pi-stale-rollback',
      scope: 'global'
    })

    expect(result).toMatchObject({ ok: false, errorCode: 'VERIFY_FAILED' })
    expect(result.logs).toEqual(
      expect.arrayContaining([expect.objectContaining({ phase: 'rollback', ok: true })])
    )
    expect(
      JSON.parse(await fs.readFile(path.join(agentDir, 'settings.json'), 'utf8')).packages
    ).toEqual(['npm:pi-stale-rollback'])
  })

  it('deletes only a verified orphan under a Pi managed root', async () => {
    await writeRegistry(agentDir, [])
    const root = await writePackage(agentDir, 'pi-delete-orphan', {
      pi: { skills: ['skills/demo/SKILL.md'] }
    })
    await fs.mkdir(path.join(root, 'skills', 'demo'), { recursive: true })
    await fs.writeFile(path.join(root, 'skills', 'demo', 'SKILL.md'), '# Demo')

    const result = await manager.deleteOrphan({
      source: 'npm:pi-delete-orphan',
      scope: 'global'
    })

    expect(result.ok).toBe(true)
    await expect(fs.stat(root)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('uses project-scoped native install and verifies the resulting registry and files', async () => {
    const projectPi = path.join(projectRoot, '.pi')
    processMock.exec.mockImplementation(async () => {
      await writeRegistry(projectPi, ['npm:pi-project'])
      await writePackage(projectPi, 'pi-project', { pi: { extensions: [] } })
      return { stdout: 'installed', stderr: '', exitCode: 0, signal: null }
    })

    const result = await manager.install(
      { source: 'npm:pi-project', scope: 'project', projectRoot },
      'repair'
    )

    expect(result.ok).toBe(true)
    expect(processMock.exec).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ['install', 'npm:pi-project', '--local', '--approve'],
        cwd: projectRoot,
        env: { PI_CODING_AGENT_DIR: agentDir }
      })
    )
  })

  it('installs the trusted Superpowers git source through the Pi CLI', async () => {
    const source = 'git:github.com/obra/superpowers'
    processMock.exec.mockImplementation(async () => {
      await writeRegistry(agentDir, [source])
      await writeGitPackage(agentDir, 'github.com/obra/superpowers', {
        name: 'superpowers',
        version: '6.3.0',
        pi: { extensions: ['.pi/extensions/superpowers.ts'] }
      })
      return { stdout: 'installed', stderr: '', exitCode: 0, signal: null }
    })

    const result = await manager.install({ source, scope: 'global' })

    expect(result).toMatchObject({ ok: true, action: 'install', source })
    expect(processMock.exec).toHaveBeenCalledWith(
      expect.objectContaining({ args: ['install', source, '--no-approve'] })
    )
  })

  it('updates one installed npm package through the Pi CLI', async () => {
    await writeRegistry(agentDir, ['npm:pi-update'])
    await writePackage(agentDir, 'pi-update', { pi: { extensions: [] } })
    processMock.exec.mockResolvedValue({ stdout: 'updated', stderr: '', exitCode: 0, signal: null })

    const result = await manager.update({ source: 'npm:pi-update', scope: 'global' })

    expect(result).toMatchObject({ ok: true, action: 'update' })
    expect(processMock.exec).toHaveBeenCalledWith(
      expect.objectContaining({ args: ['update', 'npm:pi-update', '--no-approve'] })
    )
  })

  it('updates an installed trusted git package through the Pi CLI', async () => {
    const source = 'git:github.com/obra/superpowers'
    await writeRegistry(agentDir, [source])
    await writeGitPackage(agentDir, 'github.com/obra/superpowers', {
      name: 'superpowers',
      version: '6.3.0',
      pi: { extensions: ['.pi/extensions/superpowers.ts'] }
    })
    processMock.exec.mockResolvedValue({ stdout: 'updated', stderr: '', exitCode: 0, signal: null })

    const result = await manager.update({ source, scope: 'global' })

    expect(result).toMatchObject({ ok: true, action: 'update' })
    expect(processMock.exec).toHaveBeenCalledWith(
      expect.objectContaining({ args: ['update', source, '--no-approve'] })
    )
  })

  it('updates all installed packages through pi update --extensions', async () => {
    await writeRegistry(agentDir, ['npm:pi-update-all'])
    await writePackage(agentDir, 'pi-update-all', { pi: { extensions: [] } })
    processMock.exec.mockResolvedValue({ stdout: 'updated', stderr: '', exitCode: 0, signal: null })

    const results = await manager.updateAll('global')

    expect(results).toEqual([expect.objectContaining({ ok: true, action: 'update' })])
    expect(processMock.exec).toHaveBeenCalledWith(
      expect.objectContaining({ args: ['update', '--extensions', '--no-approve'] })
    )
  })

  it('rejects package source strings that could become shell syntax', async () => {
    await expect(
      manager.install({ source: 'npm:valid$(touch /tmp/nope)', scope: 'global' })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(processMock.exec).not.toHaveBeenCalled()
  })

  it('requires local package paths to be inside an authorized root', async () => {
    const outside = path.join(sandbox, 'outside-package')
    await fs.mkdir(outside)
    const access = {
      assertAllowed: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('denied'), { code: 'PATH_DENIED' }))
    }
    const secured = new PiPackageManager(
      { peek: () => ({ manualCliPath: null, manualConfigDir: agentDir }) } as never,
      undefined,
      access as never
    )

    await expect(secured.install({ source: outside, scope: 'global' })).rejects.toMatchObject({
      code: 'PATH_DENIED'
    })
    expect(processMock.exec).not.toHaveBeenCalled()
  })

  it('disables a registered package by removing only its registry entry', async () => {
    await writeRegistry(agentDir, [{ source: 'npm:pi-toggle', skills: [] }])
    await writePackage(agentDir, 'pi-toggle', { pi: { skills: ['skills/demo/SKILL.md'] } })

    const entry = await manager.readRegistryEntry({ source: 'npm:pi-toggle', scope: 'global' })
    const result = await manager.setEnabled({ source: 'npm:pi-toggle', scope: 'global' }, false)

    expect(result).toMatchObject({ ok: true, action: 'disable', skipped: false })
    const settings = JSON.parse(await fs.readFile(path.join(agentDir, 'settings.json'), 'utf8'))
    expect(settings.packages).toEqual([])
    await expect(fs.stat(packagePath(agentDir, 'pi-toggle'))).resolves.toBeTruthy()
    expect(entry).toEqual({ source: 'npm:pi-toggle', skills: [] })
    expect((await manager.list())[0]).toMatchObject({
      registered: false,
      installed: true,
      health: 'orphaned'
    })
  })

  it('re-enables a disabled package with its exact previous registry entry', async () => {
    await writeRegistry(agentDir, [{ source: 'npm:pi-restore', skills: [] }])
    await writePackage(agentDir, 'pi-restore', { pi: { skills: ['skills/demo/SKILL.md'] } })
    await manager.setEnabled({ source: 'npm:pi-restore', scope: 'global' }, false)

    const result = await manager.setEnabled(
      { source: 'npm:pi-restore', scope: 'global' },
      true,
      { source: 'npm:pi-restore', skills: [] }
    )

    expect(result).toMatchObject({ ok: true, action: 'enable', skipped: false })
    const settings = JSON.parse(await fs.readFile(path.join(agentDir, 'settings.json'), 'utf8'))
    expect(settings.packages).toEqual([{ source: 'npm:pi-restore', skills: [] }])
    expect((await manager.list())[0]).toMatchObject({ registered: true, health: 'healthy' })
  })

  it('falls back to a plain source entry when no snapshot was captured', async () => {
    await writeRegistry(agentDir, [])
    await writePackage(agentDir, 'pi-fallback', { pi: { extensions: [] } })

    const result = await manager.setEnabled(
      { source: 'npm:pi-fallback', scope: 'global' },
      true
    )

    expect(result).toMatchObject({ ok: true, action: 'enable' })
    const settings = JSON.parse(await fs.readFile(path.join(agentDir, 'settings.json'), 'utf8'))
    expect(settings.packages).toEqual(['npm:pi-fallback'])
  })

  it('reports skipped results for redundant enable and disable calls', async () => {
    await writeRegistry(agentDir, ['npm:pi-redundant'])
    await writePackage(agentDir, 'pi-redundant', { pi: { extensions: [] } })

    await expect(
      manager.setEnabled({ source: 'npm:pi-redundant', scope: 'global' }, false)
    ).resolves.toMatchObject({ ok: true, skipped: false })
    await expect(
      manager.setEnabled({ source: 'npm:pi-redundant', scope: 'global' }, false)
    ).resolves.toMatchObject({ ok: true, skipped: true })
    await expect(
      manager.setEnabled({ source: 'npm:pi-redundant', scope: 'global' }, true)
    ).resolves.toMatchObject({ ok: true, skipped: false })
    await expect(
      manager.setEnabled({ source: 'npm:pi-redundant', scope: 'global' }, true)
    ).resolves.toMatchObject({ ok: true, skipped: true })
  })

  it('refuses to re-register package files that are missing or unmanaged', async () => {
    await writeRegistry(agentDir, [])

    await expect(
      manager.setEnabled({ source: 'npm:pi-gone', scope: 'global' }, true)
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(
      JSON.parse(await fs.readFile(path.join(agentDir, 'settings.json'), 'utf8')).packages
    ).toEqual([])
  })

  it('restores the registry when a disable transaction fails verification', async () => {
    await writeRegistry(agentDir, ['npm:pi-disable-rollback'])
    await writePackage(agentDir, 'pi-disable-rollback', { pi: { extensions: [] } })
    const [before] = await manager.list()
    vi.spyOn(manager, 'list').mockResolvedValueOnce([before!]).mockResolvedValueOnce([before!])

    const result = await manager.setEnabled(
      { source: 'npm:pi-disable-rollback', scope: 'global' },
      false
    )

    expect(result).toMatchObject({ ok: false, errorCode: 'VERIFY_FAILED' })
    expect(
      JSON.parse(await fs.readFile(path.join(agentDir, 'settings.json'), 'utf8')).packages
    ).toEqual(['npm:pi-disable-rollback'])
  })

  it('classifies npm permission failures without relying on localized UI text', () => {
    expect(classifyPackageError('npm error code EACCES')).toBe('EACCES')
    expect(classifyPackageError('permission denied')).toBe('EACCES')
    expect(classifyPackageError('network failed')).toBe('PROCESS_FAILED')
  })
})

async function writeRegistry(baseDir: string, packages: unknown[]): Promise<void> {
  await fs.mkdir(baseDir, { recursive: true })
  await fs.writeFile(path.join(baseDir, 'settings.json'), JSON.stringify({ packages }, null, 2))
}

function packagePath(baseDir: string, name: string): string {
  return path.join(baseDir, 'npm', 'node_modules', name)
}

async function writePackage(
  baseDir: string,
  name: string,
  manifest: Record<string, unknown>
): Promise<string> {
  const root = packagePath(baseDir, name)
  await fs.mkdir(root, { recursive: true })
  await fs.writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ name, version: '1.0.0', ...manifest }, null, 2)
  )
  return root
}

async function writeGitPackage(
  baseDir: string,
  repositoryPath: string,
  manifest: Record<string, unknown>
): Promise<string> {
  const root = path.join(baseDir, 'git', repositoryPath)
  await fs.mkdir(root, { recursive: true })
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify(manifest, null, 2))
  const extension = (manifest.pi as { extensions?: string[] } | undefined)?.extensions?.[0]
  if (extension) {
    const extensionPath = path.join(root, extension)
    await fs.mkdir(path.dirname(extensionPath), { recursive: true })
    await fs.writeFile(extensionPath, 'export default function () {}')
  }
  return root
}

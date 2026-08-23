import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { findTrustedCapability } from '@shared/capabilities/catalog'
import {
  assertSafeSkillChild,
  buildSkillInstallerEnvironment,
  SkillInstallService
} from './skill-installer'

describe('SkillInstallService', () => {
  let sandbox = ''
  let fixtureRoot = ''
  let targetRoot = ''
  let backupRoot = ''

  beforeEach(async () => {
    sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-harness-installer-test-'))
    fixtureRoot = path.join(sandbox, 'fixtures')
    targetRoot = path.join(sandbox, 'pi', 'skills')
    backupRoot = path.join(sandbox, 'backups')
    await fs.mkdir(path.join(fixtureRoot, 'odai'), { recursive: true })
    await fs.writeFile(
      path.join(fixtureRoot, 'odai', 'SKILL.md'),
      '---\nname: odai\ndescription: fixture\nversion: 1.0.0\n---\n\n# Odai\n'
    )
  })

  afterEach(async () => {
    await fs.rm(sandbox, { recursive: true, force: true })
  })

  function service() {
    return new SkillInstallService({
      fixtureRoot: () => fixtureRoot,
      backupRoot: () => backupRoot,
      makeTempDir: () => fs.mkdtemp(path.join(sandbox, 'stage-')),
      resolveNpm: vi.fn(async () => {
        throw new Error('fixture installs must not execute npm')
      })
    })
  }

  it('stages, validates, installs, toggles, updates, backs up, and uninstalls a skill', async () => {
    const definition = findTrustedCapability('odai')!
    const installer = service()
    const phases: string[] = []

    const installed = await installer.install(definition, targetRoot, {
      replace: false,
      onPhase: (phase) => phases.push(phase)
    })
    expect(phases).toEqual(['resolving', 'installing', 'validating'])
    expect(installed.parsed).toMatchObject({ name: 'odai', version: '1.0.0' })
    await expect(
      fs.readFile(path.join(installed.installPath, 'SKILL.md'), 'utf8')
    ).resolves.toContain('fixture')

    await expect(
      installer.install(definition, targetRoot, { replace: false })
    ).rejects.toMatchObject({ code: 'SKILL_ALREADY_INSTALLED' })

    const disabledPath = await installer.setEnabled(
      installed.installPath,
      targetRoot,
      'odai',
      false
    )
    expect(path.basename(disabledPath)).toBe('.odai.pi-harness-disabled')
    const enabledPath = await installer.setEnabled(disabledPath, targetRoot, 'odai', true)
    expect(enabledPath).toBe(path.join(targetRoot, 'odai'))

    await fs.writeFile(
      path.join(fixtureRoot, 'odai', 'SKILL.md'),
      '---\nname: odai\ndescription: updated\nversion: 2.0.0\n---\n\n# Odai\n'
    )
    const updated = await installer.install(definition, targetRoot, {
      replace: true,
      existingPath: enabledPath
    })
    expect(updated.parsed.version).toBe('2.0.0')
    expect(updated.backupPath).not.toBeNull()
    await expect(
      fs.readFile(path.join(updated.backupPath!, 'SKILL.md'), 'utf8')
    ).resolves.toContain('version: 1.0.0')

    const uninstallBackup = await installer.uninstall(updated.installPath, targetRoot, 'odai')
    await expect(fs.stat(updated.installPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.readFile(path.join(uninstallBackup, 'SKILL.md'), 'utf8')).resolves.toContain(
      'version: 2.0.0'
    )
  })

  it('rejects traversal and invalid staged skills', async () => {
    expect(() => assertSafeSkillChild(targetRoot, '../odai')).toThrow(
      expect.objectContaining({ code: 'SKILL_PATH_INVALID' })
    )
    await expect(
      service().install(findTrustedCapability('odai')!, targetRoot, {
        replace: true,
        existingPath: path.join(targetRoot, 'nested', 'odai')
      })
    ).rejects.toMatchObject({ code: 'SKILL_PATH_INVALID' })
    await fs.rm(path.join(fixtureRoot, 'odai', 'SKILL.md'))
    await expect(
      service().install(findTrustedCapability('odai')!, targetRoot, { replace: false })
    ).rejects.toMatchObject({ code: 'SKILL_INVALID' })
  })

  it('never follows a managed-path symlink during destructive operations', async () => {
    const outside = path.join(sandbox, 'outside-odai')
    await fs.mkdir(targetRoot, { recursive: true })
    await fs.mkdir(outside)
    await fs.writeFile(
      path.join(outside, 'SKILL.md'),
      '---\nname: odai\ndescription: outside\n---\n\n# Outside\n'
    )
    await fs.symlink(outside, path.join(targetRoot, 'odai'))

    await expect(
      service().uninstall(path.join(targetRoot, 'odai'), targetRoot, 'odai')
    ).rejects.toMatchObject({ code: 'SKILL_PATH_INVALID' })
    await expect(fs.readFile(path.join(outside, 'SKILL.md'), 'utf8')).resolves.toContain(
      '# Outside'
    )
  })

  it('executes the trusted source as a fixed argument array', async () => {
    const run = vi.fn(async (_executable: string, args: string[], options: { cwd: string }) => {
      const staged = path.join(options.cwd, '.pi', 'agent', 'skills', 'odai')
      await fs.mkdir(staged, { recursive: true })
      await fs.writeFile(
        path.join(staged, 'SKILL.md'),
        '---\nname: odai\ndescription: staged\n---\n\n# Odai\n'
      )
      return { stdout: 'installed', stderr: '', exitCode: 0 }
    })
    const installer = new SkillInstallService({
      fixtureRoot: () => null,
      backupRoot: () => backupRoot,
      makeTempDir: () => fs.mkdtemp(path.join(sandbox, 'stage-')),
      resolveNpm: async () => '/tmp/bin/npm',
      runCommand: run
    })

    await installer.install(findTrustedCapability('odai')!, targetRoot, { replace: false })

    expect(run).toHaveBeenCalledWith(
      '/tmp/bin/npm',
      [
        'exec',
        '--yes',
        '--package',
        'skills',
        '--',
        'skills',
        'add',
        'https://github.com/orziz/odai',
        '--skill',
        'odai',
        '--global',
        '--agent',
        'pi',
        '--copy',
        '--yes'
      ],
      expect.objectContaining({ timeoutMs: 5 * 60_000 })
    )
  })

  it('runs third-party installer code with an isolated minimal environment', () => {
    const env = buildSkillInstallerEnvironment(
      {
        PATH: '/usr/local/bin:/usr/bin',
        LANG: 'zh_CN.UTF-8',
        HTTPS_PROXY: 'http://proxy.example.test:8080',
        OPENAI_API_KEY: 'secret-openai-key',
        NPM_TOKEN: 'secret-npm-token',
        GITHUB_TOKEN: 'secret-github-token',
        AWS_SECRET_ACCESS_KEY: 'secret-aws-key'
      },
      '/tmp/pi-harness-isolated-home',
      '/opt/node/bin/npm'
    )

    expect(env).not.toHaveProperty('OPENAI_API_KEY')
    expect(env).not.toHaveProperty('NPM_TOKEN')
    expect(env).not.toHaveProperty('GITHUB_TOKEN')
    expect(env).not.toHaveProperty('AWS_SECRET_ACCESS_KEY')
    expect(env).toMatchObject({
      HOME: '/tmp/pi-harness-isolated-home',
      USERPROFILE: '/tmp/pi-harness-isolated-home',
      LANG: 'zh_CN.UTF-8',
      HTTPS_PROXY: 'http://proxy.example.test:8080',
      npm_config_ignore_scripts: 'true',
      npm_config_userconfig: '/tmp/pi-harness-isolated-home/.npmrc',
      npm_config_globalconfig: '/tmp/pi-harness-isolated-home/.npm-globalrc'
    })
    expect(env.PATH).toBe(['/opt/node/bin', '/usr/local/bin:/usr/bin'].join(path.delimiter))
  })
})
